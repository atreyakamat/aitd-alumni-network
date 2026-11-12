# Archive

Documents kept only for history. **Do not follow them for configuration.**

The root-level deployment guides that used to live here described a MySQL shared-host deployment that no longer exists (the platform runs on
PostgreSQL, Redis and Kafka with Docker Compose). The current documents are [DOCKER.md](../DOCKER.md), [PRODUCTION_CHECKLIST.md](../PRODUCTION_CHECKLIST.md)
and [DOCKER_TEST_GUIDE.md](../DOCKER_TEST_GUIDE.md).

They stay in the repository because earlier security notes refer to them by name (a database password was committed in two of them, see
`SECURITY_AUDIT.md` OP-01: it must be treated as public and rotated).
