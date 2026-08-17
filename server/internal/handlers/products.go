package handlers

import (
	"database/sql"
	"net/http"
	"strconv"

	"shop-dd/internal/models"
	"github.com/gin-gonic/gin"
)

// GetProducts — GET /api/products
// status='listed' 상품만, id DESC 정렬, KRW 표시 (sale_price_krw).
func GetProducts(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		rows, err := db.Query(`
			SELECT id, selling_product_id, title, COALESCE(description, ''),
			       COALESCE(image_url, ''), COALESCE(source_url, ''),
			       COALESCE(sale_price_krw, 0), COALESCE(original_price_krw, 0),
			       COALESCE(margin_pct, ''), COALESCE(volume, 0), status,
			       COALESCE(stock, 1), synced_at, created_at, updated_at
			FROM products
			WHERE status = 'listed'
			ORDER BY id DESC
		`)
		if err != nil {
			respondDBError(c, err)
			return
		}
		defer rows.Close()

		products := []models.Product{}
		for rows.Next() {
			var p models.Product
			var salePrice, origPrice int
			if err := rows.Scan(
				&p.ID, &p.SellingProductID, &p.Title, &p.Description,
				&p.ImageURL, &p.SourceURL, &salePrice, &origPrice,
				&p.MarginPct, &p.Volume, &p.Status, &p.Stock,
				&p.SyncedAt, &p.CreatedAt, &p.UpdatedAt,
			); err != nil {
				respondDBError(c, err)
				return
			}
			p.SalePriceKRW = &salePrice
			p.OriginalPriceKRW = &origPrice
			products = append(products, p)
		}

		c.JSON(http.StatusOK, gin.H{"products": products})
	}
}

// GetProduct — GET /api/products/:id
// 단일 상품. 없거나 listed가 아니면 404.
func GetProduct(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.Atoi(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid product ID"})
			return
		}

		var p models.Product
		var salePrice, origPrice int
		err = db.QueryRow(`
			SELECT id, selling_product_id, title, COALESCE(description, ''),
			       COALESCE(image_url, ''), COALESCE(source_url, ''),
			       COALESCE(sale_price_krw, 0), COALESCE(original_price_krw, 0),
			       COALESCE(margin_pct, ''), COALESCE(volume, 0), status,
			       COALESCE(stock, 1), synced_at, created_at, updated_at
			FROM products
			WHERE id = $1 AND status = 'listed'
		`, id).Scan(
			&p.ID, &p.SellingProductID, &p.Title, &p.Description,
			&p.ImageURL, &p.SourceURL, &salePrice, &origPrice,
			&p.MarginPct, &p.Volume, &p.Status, &p.Stock,
			&p.SyncedAt, &p.CreatedAt, &p.UpdatedAt,
		)

		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "Product not found"})
			return
		}
		if err != nil {
			respondDBError(c, err)
			return
		}
		p.SalePriceKRW = &salePrice
		p.OriginalPriceKRW = &origPrice

		c.JSON(http.StatusOK, p)
	}
}
