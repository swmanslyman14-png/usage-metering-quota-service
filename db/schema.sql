CREATE TABLE plans (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_account_id BIGINT,
    name VARCHAR(100) NOT NULL,
    plan_type VARCHAR(10) NOT NULL
        CHECK (plan_type IN ('account', 'user')),
    monthly_limit BIGINT NOT NULL
        CHECK (monthly_limit > 0),
    max_per_request BIGINT NOT NULL
        CHECK (max_per_request > 0),
    is_predefined BOOLEAN NOT NULL DEFAULT FALSE,

    CONSTRAINT plans_ownership_check CHECK (
        (is_predefined = TRUE AND owner_account_id IS NULL)
        OR
        (is_predefined = FALSE AND owner_account_id IS NOT NULL)
    )
);

CREATE TABLE accounts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    api_key_hash VARCHAR(64) NOT NULL UNIQUE,
    plan_id BIGINT NOT NULL REFERENCES plans(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE plans
ADD CONSTRAINT plans_owner_account_fk
FOREIGN KEY (owner_account_id)
REFERENCES accounts(id);

CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id),
    name VARCHAR(100) NOT NULL,
    plan_id BIGINT NOT NULL REFERENCES plans(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (account_id, id)
);

CREATE TABLE account_usage (
    account_id BIGINT NOT NULL REFERENCES accounts(id),
    month DATE NOT NULL,
    units_used BIGINT NOT NULL DEFAULT 0
        CHECK (units_used >= 0),

    PRIMARY KEY (account_id, month),
    CHECK (EXTRACT(DAY FROM month) = 1)
);

CREATE TABLE user_usage (
    account_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    month DATE NOT NULL,
    units_used BIGINT NOT NULL DEFAULT 0
        CHECK (units_used >= 0),

    PRIMARY KEY (user_id, month),

    FOREIGN KEY (account_id, user_id)
        REFERENCES users(account_id, id),

    CHECK (EXTRACT(DAY FROM month) = 1)
);

CREATE TABLE consumption_requests (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    request_id VARCHAR(128) NOT NULL,
    units BIGINT NOT NULL CHECK (units > 0),
    accepted BOOLEAN NOT NULL,
    rejection_reason VARCHAR(100),
    account_plan_id BIGINT NOT NULL REFERENCES plans(id),
    user_plan_id BIGINT NOT NULL REFERENCES plans(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    FOREIGN KEY (account_id, user_id)
        REFERENCES users(account_id, id),

    UNIQUE (account_id, request_id),

    CHECK (
        (accepted = TRUE AND rejection_reason IS NULL)
        OR
        (accepted = FALSE AND rejection_reason IS NOT NULL)
    )
);

CREATE INDEX consumption_requests_user_history_idx
    ON consumption_requests (account_id, user_id, created_at DESC, id DESC);

CREATE INDEX consumption_requests_account_history_idx
    ON consumption_requests (account_id, created_at DESC, id DESC);