package models

import "time"

// User represents a registered user. Wallet users are provisioned with a
// `<wallet>@wallet.local` email and a random bcrypt password so password login
// is impossible (is_wallet_user=true).
type User struct {
	ID           int       `json:"id" db:"id"`
	Email        string    `json:"email" db:"email"`
	Password     string    `json:"-" db:"password"` // Never expose password in JSON
	Name         string    `json:"name" db:"name"`
	Role         string    `json:"role" db:"role"` // "buyer", "admin"
	IsWalletUser bool      `json:"isWalletUser" db:"is_wallet_user"`
	CreatedAt    time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt    time.Time `json:"updatedAt" db:"updated_at"`
}

// Product represents a synced product from the selling pipeline.
type Product struct {
	ID              int       `json:"id" db:"id"`
	SellingProductID int      `json:"sellingProductId" db:"selling_product_id"`
	Title           string    `json:"title" db:"title"`
	Description     string    `json:"description" db:"description"`
	ImageURL        string    `json:"imageUrl" db:"image_url"`
	SourceURL       string    `json:"sourceUrl" db:"source_url"`
	SalePriceKRW    *int      `json:"salePriceKrw,omitempty" db:"sale_price_krw"`
	OriginalPriceKRW *int     `json:"originalPriceKrw,omitempty" db:"original_price_krw"`
	MarginPct       string    `json:"marginPct,omitempty" db:"margin_pct"`
	Volume          int       `json:"volume" db:"volume"`
	Status          string    `json:"status" db:"status"` // "listed" | "unlisted"
	Stock           int       `json:"stock" db:"stock"`
	SyncedAt        time.Time `json:"syncedAt" db:"synced_at"`
	CreatedAt       time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt       time.Time `json:"updatedAt" db:"updated_at"`
}

// Order represents a purchase order. id doubles as the gateway reference_id.
type Order struct {
	ID              int       `json:"id" db:"id"`
	UserID          int       `json:"userId" db:"user_id"`
	WalletAddress   string    `json:"walletAddress" db:"wallet_address"`
	Status          string    `json:"status" db:"status"` // pending | registered | paid | fulfilled | cancelled
	TotalKRW        int       `json:"totalKrw" db:"total_krw"`
	TotalUsdcMicro  int64     `json:"totalUsdcMicro" db:"total_usdc_micro"`
	GatewayOrderID  string    `json:"gatewayOrderId,omitempty" db:"gateway_order_id"`
	TxHash          string    `json:"txHash,omitempty" db:"tx_hash"`
	CreatedAt       time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt       time.Time `json:"updatedAt" db:"updated_at"`
	Items           []OrderItem `json:"items,omitempty"`
}

// OrderItem represents a single line item within an order.
type OrderItem struct {
	ID        int    `json:"id" db:"id"`
	OrderID   int    `json:"orderId" db:"order_id"`
	ProductID int    `json:"productId" db:"product_id"`
	Title     string `json:"title" db:"title"`
	PriceKRW  int    `json:"priceKrw" db:"price_krw"`
	Qty       int    `json:"qty" db:"qty"`
}

// ── Request / Response types ──────────────────────────────────────────────

type NonceRequest struct {
	WalletAddress string `json:"walletAddress" binding:"required"`
}

type NonceResponse struct {
	Nonce     string `json:"nonce"`
	Message   string `json:"message"`
	ExpiresIn int    `json:"expiresIn"`
}

type VerifyRequest struct {
	WalletAddress string `json:"walletAddress" binding:"required"`
	Signature     string `json:"signature" binding:"required"`
	Nonce         string `json:"nonce" binding:"required"`
}

type WalletAuthResponse struct {
	Token         string `json:"token"`
	WalletAddress string `json:"walletAddress"`
	User          User   `json:"user"`
}

type CreateOrderRequest struct {
	Items []OrderItemRequest `json:"items" binding:"required,min=1"`
}

type OrderItemRequest struct {
	ProductID int `json:"productId" binding:"required"`
	Qty       int `json:"qty" binding:"required,min=1"`
}

type CreateOrderResponse struct {
	OrderID         int    `json:"order_id"`
	AmountUsdcMicro int64  `json:"amount_usdc_micro"`
	GatewayOrderID  string `json:"gateway_order_id"`
	ContractAddress string `json:"contract_address"`
	UsdcToken       string `json:"usdc_token"`
}
