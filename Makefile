# AIEM Connection — common Docker tasks.
# One-command setup:  make up   (or ./start.sh)
.PHONY: up down logs restart rebuild ps reset seed-sample

up: ## First-run setup + start everything (generates .env with secrets if missing)
	./start.sh

down: ## Stop the stack (keeps data)
	docker compose down

logs: ## Tail logs from all services
	docker compose logs -f

restart: ## Restart all services
	docker compose restart

rebuild: ## Rebuild images and restart
	docker compose up -d --build

ps: ## Show container status
	docker compose ps

reset: ## Stop and DELETE all data (postgres, redis, uploads)
	docker compose down -v

seed-sample: ## Load demo users/events/news into the running DB
	docker compose exec -e SEED_SAMPLE_DATA=true api npx tsx prisma/seed.ts
