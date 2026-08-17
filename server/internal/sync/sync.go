package sync

import (
	"database/sql"
	"log"
	"math"
	"os"
	"strconv"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

// ── 상품 동기화 워커 ──────────────────────────────────────────────────────
// selling_dd Postgres(5432)의 products를 shop_dd DB로 upsert한다.
// - ticker 5분 + 시작 시 1회 실행
// - DB 다운 시 로그 + 재시도 (API 무중단)
// - 삭제는 soft (status='unlisted')

const syncInterval = 5 * time.Minute

// sanitizeExternalURL allows only http/https absolute URLs, dropping
// javascript:, data:, and other dangerous or relative schemes.
func sanitizeExternalURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	lower := strings.ToLower(raw)
	if !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") {
		return ""
	}
	return raw
}

// KRW 변환: int(float(usd)*1350) → round(/100)*100
func usdToKRW(usdStr string) (int, bool) {
	usdStr = strings.TrimSpace(usdStr)
	if usdStr == "" {
		return 0, false
	}
	usd, err := strconv.ParseFloat(usdStr, 64)
	if err != nil || usd <= 0 {
		return 0, false
	}
	krw := int(usd * 1350)
	krw = int(math.Round(float64(krw)/100) * 100)
	return krw, true
}

// isListed — status='manifest_ready' AND sale_price 유효(>0)
func isListed(status, salePrice string) bool {
	if status != "manifest_ready" {
		return false
	}
	_, ok := usdToKRW(salePrice)
	return ok
}

// Run starts the sync worker. It runs once immediately, then on a 5-minute
// ticker. Returns immediately (non-blocking).
func Run(shopDB *sql.DB) {
	go func() {
		syncOnce(shopDB)
		ticker := time.NewTicker(syncInterval)
		defer ticker.Stop()
		for range ticker.C {
			syncOnce(shopDB)
			// 미결제 주문 만료 + 재고 복원 (Strix 권고 2 — 15분)
			if _, err := ExpirePendingOrders(shopDB, 15*time.Minute); err != nil {
				log.Printf("[sync] expire pending orders failed: %v", err)
			}
		}
	}()
}

// syncOnce performs a single sync pass. On any error it logs and returns so the
// next tick retries (no-downtime).
func syncOnce(shopDB *sql.DB) {
	sellingURL := os.Getenv("SELLING_DB_URL")
	if sellingURL == "" {
		log.Println("[sync] SELLING_DB_URL not set, skipping sync")
		return
	}

	sellingDB, err := sql.Open("postgres", sellingURL)
	if err != nil {
		log.Printf("[sync] failed to open selling DB: %v", err)
		return
	}
	defer sellingDB.Close()

	if err := sellingDB.Ping(); err != nil {
		log.Printf("[sync] selling DB unreachable: %v", err)
		return
	}

	rows, err := sellingDB.Query(`
		SELECT id, COALESCE(title, ''), COALESCE(description, ''),
		       COALESCE(image_url, ''), COALESCE(source_url, ''),
		       COALESCE(status, ''), COALESCE(sale_price, ''),
		       COALESCE(original_price, ''), COALESCE(margin_pct, ''),
		       COALESCE(volume, 0)
		FROM products
	`)
	if err != nil {
		log.Printf("[sync] selling DB query failed: %v", err)
		return
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var id int
		var title, description, imageURL, sourceURL, status, salePrice, origPrice, marginPct string
		var volume int
		if err := rows.Scan(&id, &title, &description, &imageURL, &sourceURL,
			&status, &salePrice, &origPrice, &marginPct, &volume); err != nil {
			log.Printf("[sync] scan failed: %v", err)
			continue
		}

		sourceURL = sanitizeExternalURL(sourceURL)

		saleKRW, saleOK := usdToKRW(salePrice)
		origKRW, origOK := usdToKRW(origPrice)

		listed := isListed(status, salePrice)
		productStatus := "unlisted"
		if listed {
			productStatus = "listed"
		}

		var saleKRWPtr, origKRWPtr *int
		if saleOK {
			saleKRWPtr = &saleKRW
		}
		if origOK {
			origKRWPtr = &origKRW
		}

		_, err = shopDB.Exec(`
			INSERT INTO products (selling_product_id, title, description, image_url, source_url,
			                      sale_price_krw, original_price_krw, margin_pct, volume, status, synced_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
			ON CONFLICT (selling_product_id) DO UPDATE
				SET title = EXCLUDED.title,
				    description = EXCLUDED.description,
				    image_url = EXCLUDED.image_url,
				    source_url = EXCLUDED.source_url,
				    sale_price_krw = EXCLUDED.sale_price_krw,
				    original_price_krw = EXCLUDED.original_price_krw,
				    margin_pct = EXCLUDED.margin_pct,
				    volume = EXCLUDED.volume,
				    status = EXCLUDED.status,
				    synced_at = NOW(),
				    updated_at = CURRENT_TIMESTAMP
		`, id, title, description, imageURL, sourceURL,
			saleKRWPtr, origKRWPtr, marginPct, volume, productStatus)
		if err != nil {
			log.Printf("[sync] upsert failed (selling_product_id=%d): %v", id, err)
			continue
		}
		count++
	}

	log.Printf("[sync] sync complete: %d products upserted", count)
}
