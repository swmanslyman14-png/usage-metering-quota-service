INSERT INTO plans (
    name,
    plan_type,
    monthly_limit,
    max_per_request,
    is_predefined
)
VALUES
    ('Starter', 'account', 1000, 100, TRUE),
    ('Pro', 'account', 10000, 1000, TRUE),
    ('Basic', 'user', 200, 50, TRUE),
    ('Premium', 'user', 2000, 200, TRUE);