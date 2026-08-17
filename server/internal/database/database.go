package database

import (
	"database/sql"
	"fmt"
	"log"
	"os"

	_ "github.com/lib/pq"
)

// InitDB connects to the shop_dd Postgres database (default localhost:5435).
func InitDB() (*sql.DB, error) {
	host := os.Getenv("DB_HOST")
	if host == "" {
		host = "localhost"
	}

	port := os.Getenv("DB_PORT")
	if port == "" {
		port = "5435"
	}

	user := os.Getenv("DB_USER")
	if user == "" {
		user = "shop_dd"
	}

	password := os.Getenv("DB_PASSWORD")
	if password == "" {
		password = "shop_dd"
	}

	dbname := os.Getenv("DB_NAME")
	if dbname == "" {
		dbname = "shop_dd"
	}

	connStr := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		host, port, user, password, dbname)

	log.Printf("Connecting to database: host=%s port=%s dbname=%s", host, port, dbname)

	db, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	log.Println("Successfully connected to database")
	return db, nil
}

// CreateTables creates all tables idempotently. Every statement uses
// CREATE TABLE IF NOT EXISTS / ALTER TABLE ADD COLUMN IF NOT EXISTS so the
// migration is safe to run on every startup.
func CreateTables(db *sql.DB) error {
	// users
	createUsersSQL := `
	CREATE TABLE IF NOT EXISTS users (
		id SERIAL PRIMARY KEY,
		email VARCHAR(255) UNIQUE NOT NULL,
		password TEXT NOT NULL,
		name VARCHAR(255) NOT NULL,
		role VARCHAR(50) NOT NULL DEFAULT 'buyer',
		is_wallet_user BOOLEAN NOT NULL DEFAULT FALSE,
		created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
	`
	if _, err := db.Exec(createUsersSQL); err != nil {
		return fmt.Errorf("failed to create users table: %w", err)
	}
	log.Println("Successfully created users table")

	// auth_challenges (nonce single-use, TTL)
	createAuthChallengesSQL := `
	CREATE TABLE IF NOT EXISTS auth_challenges (
		nonce VARCHAR(128) PRIMARY KEY,
		wallet_address VARCHAR(42) NOT NULL,
		challenge_type VARCHAR(32) NOT NULL DEFAULT 'wallet',
		used_at TIMESTAMPTZ,
		expires_at TIMESTAMPTZ NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_auth_challenges_wallet ON auth_challenges(wallet_address);
	`
	if _, err := db.Exec(createAuthChallengesSQL); err != nil {
		return fmt.Errorf("failed to create auth_challenges table: %w", err)
	}
	log.Println("Successfully created auth_challenges table")

	// products (synced from selling pipeline)
	createProductsSQL := `
	CREATE TABLE IF NOT EXISTS products (
		id SERIAL PRIMARY KEY,
		selling_product_id INTEGER UNIQUE,
		title VARCHAR(500) NOT NULL,
		description TEXT,
		image_url VARCHAR(500),
		source_url VARCHAR(500),
		sale_price_krw INTEGER,
		original_price_krw INTEGER,
		margin_pct VARCHAR(50),
		volume INTEGER,
		status VARCHAR(16) NOT NULL DEFAULT 'unlisted',
		stock INTEGER NOT NULL DEFAULT 1,
		synced_at TIMESTAMPTZ,
		created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
	CREATE INDEX IF NOT EXISTS idx_products_selling_product_id ON products(selling_product_id);
	`
	if _, err := db.Exec(createProductsSQL); err != nil {
		return fmt.Errorf("failed to create products table: %w", err)
	}
	log.Println("Successfully created products table")

	// orders (id doubles as gateway reference_id)
	createOrdersSQL := `
	CREATE TABLE IF NOT EXISTS orders (
		id SERIAL PRIMARY KEY,
		user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
		wallet_address VARCHAR(42) NOT NULL,
		status VARCHAR(16) NOT NULL DEFAULT 'pending',
		total_krw INTEGER NOT NULL,
		total_usdc_micro BIGINT NOT NULL,
		gateway_order_id VARCHAR(80),
		tx_hash VARCHAR(80),
		created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
	CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
	`
	if _, err := db.Exec(createOrdersSQL); err != nil {
		return fmt.Errorf("failed to create orders table: %w", err)
	}
	log.Println("Successfully created orders table")

	// order_items
	createOrderItemsSQL := `
	CREATE TABLE IF NOT EXISTS order_items (
		id SERIAL PRIMARY KEY,
		order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
		product_id INTEGER REFERENCES products(id),
		title VARCHAR(500) NOT NULL,
		price_krw INTEGER NOT NULL,
		qty INTEGER NOT NULL DEFAULT 1
	);
	CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
	`
	if _, err := db.Exec(createOrderItemsSQL); err != nil {
		return fmt.Errorf("failed to create order_items table: %w", err)
	}
	log.Println("Successfully created order_items table")

	return nil
}
