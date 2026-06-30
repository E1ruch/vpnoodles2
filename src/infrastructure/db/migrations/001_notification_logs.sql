-- Migration: создать таблицу notification_logs (журнал отправленных уведомлений)
-- Безопасно для существующих данных: CREATE TABLE IF NOT EXISTS.
-- Колонки названы в camelCase (как в TypeORM-сущностях), поэтому в SQL берём в кавычки.

CREATE TABLE IF NOT EXISTS "notification_logs" (
    "id"            uuid            PRIMARY KEY,
    "userId"        uuid            NOT NULL,
    "type"          varchar(100)    NOT NULL,
    "entityType"    varchar(100),
    "entityId"      varchar(255),
    "cycleKey"      varchar(100),
    "delivered"     boolean         NOT NULL DEFAULT true,
    "errorMessage"  varchar(500),
    "metadata"      jsonb,
    "createdAt"     timestamp       NOT NULL DEFAULT now()
);

-- Индекс по userId — основной запрос дедупликации и списка уведомлений пользователя.
CREATE INDEX IF NOT EXISTS "idx_notification_logs_userId"
    ON "notification_logs" ("userId");

-- Индекс по createdAt — сортировка «последние» в админ-панели.
CREATE INDEX IF NOT EXISTS "idx_notification_logs_createdAt"
    ON "notification_logs" ("createdAt" DESC);
