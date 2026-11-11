# Notifications through Kafka

Every notification the platform sends travels as an **event**: the in-app notifications (likes, follows, messages, ...), the
announcement broadcasts, and the registration flow (the e-mail to the **college administrator** when a registration is waiting, and
the e-mails to the applicant). Kafka carries the events; a consumer delivers them (stores the in-app notification, pushes it to the
member if they are online, sends the e-mail through SMTP).

This page is for whoever runs the platform. The approval workflow itself is in [AUTHENTICATION.md](AUTHENTICATION.md#alumni-approval).

## What happens to a new registration

```
applicant submits the form ──► account is PENDING ──► (applicant verifies the e-mail link)
                                                            │
                                        event registration.submitted
                                                            ▼
                                   Kafka topic  <prefix>.notifications
                                                            ▼
                                       consumer (in the API process)
                          ┌────────────────────┼───────────────────────────┐
                          ▼                    ▼                           ▼
        e-mail (SMTP) to every      in-app notice "New registration   e-mail to APPROVAL_NOTIFY_EMAIL
        college administrator       to review" (bell + /admin/approvals)   (e.g. the alumni office), if set

college administrator approves or rejects at /admin/approvals
        ──► events registration.approved / registration.rejected ──► e-mail to the applicant (rejection includes the reason)
```

The **college administrator** is any active account with the role `ADMIN` or `SUPER_ADMIN` (chapter administrators are not). Give the
person that role on *Admin > Users*, or set `SEED_ADMIN_EMAIL` for the first one. The alumni office can also be told through a shared
mailbox with `APPROVAL_NOTIFY_EMAIL=alumni-office@college.edu` (several addresses may be separated by commas).

If a registration arrives while no administrator exists and `APPROVAL_NOTIFY_EMAIL` is empty, nobody can be told: the consumer logs a
warning (`A registration is waiting but there is no administrator account ...`). Create the administrator first.

## The events

| Event | Sent when | What the consumer does |
|---|---|---|
| `notification.deliver` | any in-app notification (follow, reaction, message, ...) | stores it, pushes it to the member's open sockets |
| `notification.broadcast` | an administrator announcement | stores one for every active member (batches of 1,000) |
| `registration.submitted` | the applicant's address is verified (or at once when e-mail verification is off) | e-mail + in-app notice to every college administrator, e-mail to `APPROVAL_NOTIFY_EMAIL` |
| `registration.received` | the applicant verified the address | e-mail: "we received your registration" |
| `registration.approved` | an administrator approved | e-mail: "you can sign in" |
| `registration.rejected` | an administrator rejected | e-mail with the reason |

An event is a small JSON envelope `{ id, type, version, occurredAt, data }`. The data is validated when it is published and when it is
consumed. Events carry ids, not addresses: the consumer looks the person up when it delivers (so a changed address or a deleted account
is respected). The partition key is the member (or applicant), so one person's events are handled in order.

## Running it

`docker-compose.yml` has a `kafka` service (Apache Kafka 3.9, one node that is its own controller: KRaft, no ZooKeeper). It is not
published on the host; the API reaches it at `kafka:9092`, waits until it is healthy, and creates the two topics itself.

| Setting | Default | Meaning |
|---|---|---|
| `KAFKA_BROKERS` | `kafka:9092` in compose, empty otherwise | Comma separated `host:port` list. **Empty = no Kafka: events are handled in-process** (development and tests) |
| `KAFKA_TOPIC_PREFIX` | `aiem` | Topics are `<prefix>.notifications` and `<prefix>.notifications.dlq` |
| `KAFKA_PARTITIONS` | `3` | Partitions of the notifications topic (the dead-letter topic has one). More partitions allow more API replicas to consume in parallel |
| `KAFKA_REPLICATION_FACTOR` | `1` | Raise to 3 on a three-broker cluster |
| `KAFKA_GROUP_ID` | `aiem-notifications` | Consumer group; every API replica joins it |
| `KAFKA_MAX_ATTEMPTS` | `5` | Delivery attempts (pauses of 1 s, 2 s, 4 s, ...) before an event goes to the dead-letter topic |
| `KAFKA_CONSUMER_ENABLED` | `true` | `false` on API replicas when a separate worker process runs the consumer |
| `KAFKA_SSL`, `KAFKA_SASL_MECHANISM`, `KAFKA_SASL_USERNAME`, `KAFKA_SASL_PASSWORD` | off | For a managed or secured cluster (`plain`, `scram-sha-256`, `scram-sha-512`) |
| `APPROVAL_NOTIFY_EMAIL` | empty | Extra mailbox(es) told about a waiting registration |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` (or `SENDGRID_API_KEY`) | | The mail server. Without one, e-mails are only printed to the log (development) and the production guard refuses to start |

`GET /health` shows `kafkaStatus`: `up`, `down` (configured but not connected) or `disabled`. It is informational: a `down` broker does not
make the API unhealthy because events fall back to in-process delivery.

## When something fails

* **The broker is down or unreachable:** publishing fails, the API logs `Kafka publish failed; delivering in-process` and delivers the
  event itself, so no notification and no e-mail is lost. The consumer keeps trying to connect in the background; the API never waits for it.
* **The mail server is down:** the consumer retries (and `sendEmail` itself retries transient SMTP errors); after `KAFKA_MAX_ATTEMPTS` the
  event goes to the **dead-letter topic** with the error in its headers (`x-error`, `x-attempts`, `x-reason`, `x-original-topic`,
  `x-failed-at`) and the consumer carries on. One bad event never blocks the others.
* **A message that is not a valid event** (not JSON, unknown type, wrong data) goes to the dead-letter topic at once, without retries.
* **Delivery is at-least-once.** A redelivered in-app notification is stored once (the event id is kept in its metadata), a redelivered
  broadcast is not sent twice, an administrator who already has the notice is not told twice. A redelivery after a crash can, rarely,
  repeat an e-mail.

Look at the dead-letter topic (from the machine that runs compose):

```bash
docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 \
  --topic aiem.notifications.dlq --from-beginning --property print.headers=true --timeout-ms 5000
```

Alert on a growing dead-letter topic and on `"level":"error"` lines that say `moving it to the dead-letter topic`. Replaying dead-lettered
events is manual today (publish the message value again to `aiem.notifications`); a replay command is on the open list below.

## Honest limits

* The Kafka service and the consumer are covered by unit tests with a fake `kafkajs` client and by tests of `docker-compose.yml`. **A real broker
  is exercised by `node scripts/docker-verify/run.mjs`** ([DOCKER_TEST_GUIDE.md](DOCKER_TEST_GUIDE.md); also in GitHub CI): registration through Kafka with the
  e-mails read from a mail catcher, a broker outage, poison messages, duplicates, the API down, restarts. Until that run has passed on your Docker host,
  this pipeline is untested against a real broker. Start the stack once on the server, register a test
  applicant and watch the administrator's inbox before relying on it ([PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) section 9).
* One broker is one point of failure; a managed cluster or three brokers is the production-grade setup (`KAFKA_REPLICATION_FACTOR=3`).
* Open: a command to list and replay the dead-letter topic; a lag/alert dashboard.
