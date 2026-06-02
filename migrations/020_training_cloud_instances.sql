CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS training_cloud_instances (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider               TEXT NOT NULL DEFAULT 'digitalocean',
    droplet_id             BIGINT UNIQUE,
    name                   TEXT NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'none'
                           CHECK (status IN ('none', 'provisioning', 'booting', 'installing', 'ready', 'training', 'syncing', 'destroying', 'destroyed', 'failed')),
    region                 TEXT,
    size_slug              TEXT,
    image_slug             TEXT,
    public_ipv4            INET,
    aitk_api_url           TEXT,
    tags                   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    metadata               JSONB NOT NULL DEFAULT '{}'::JSONB,
    error                  TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ready_at               TIMESTAMPTZ,
    destroyed_at           TIMESTAMPTZ,
    destroy_after          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_training_cloud_instances_status ON training_cloud_instances(status);
CREATE INDEX IF NOT EXISTS idx_training_cloud_instances_created ON training_cloud_instances(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_training_cloud_instances_droplet_id ON training_cloud_instances(droplet_id);
