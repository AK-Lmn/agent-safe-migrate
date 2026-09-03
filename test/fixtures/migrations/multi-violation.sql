-- Kitchen sink: multiple unsafe patterns
-- Should trigger MG001, MG003, MG005, MG007, MG009

ALTER TABLE users ADD COLUMN display_name VARCHAR(255) NOT NULL;

CREATE INDEX idx_orders_user_id ON orders (user_id);

ALTER TABLE users DROP COLUMN legacy_field;

ALTER TABLE products RENAME COLUMN sku TO product_sku;
