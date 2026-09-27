package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strconv"

	"shop-dd/internal/models"
	"github.com/gin-gonic/gin"
)

// orderReference — 게이트웨이 reference_id에 네임스페이스를 붙인다.
// DB 재시드 등으로 주문 id가 재사용돼도 온체인 orderId(keccak256(reference_id))가
// 과거 테스트 결제(keccak("2") 등)와 충돌하지 않게 한다. (2026-09-27)
func orderReference(orderID int) string {
	return "shop_dd-" + strconv.Itoa(orderID)
}

// CreateOrder — POST /api/orders (JWT)
// items 검증 (stock/listed) → total_krw 계산 → order 생성 (pending) →
// gateway register → 성공 시 registered + gateway_order_id 저장, 실패 시 pending 유지.
func CreateOrder(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, exists := c.Get("userId")
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			return
		}
		walletAddr, _ := c.Get("walletAddress")
		wallet := fmt.Sprintf("%v", walletAddr)
		if wallet == "<nil>" || wallet == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "wallet not connected"})
			return
		}

		var req models.CreateOrderRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// ⓪ 배송지 검증 (선택 — 값이 있으면 DB/재고를 건드리기 전에 검증, 위반 시 400)
		shipping := normaliseShipping(req.Shipping)
		if msg := validateShipping(shipping); msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}

		// ① items 집계 — 중복 productId 합산 (오버셀 방지, CWE-639)
		type lineItem struct {
			productID int
			title     string
			priceKRW  int
			qty       int
		}
		qtyByProduct := make(map[int]int)
		for _, it := range req.Items {
			if it.ProductID <= 0 || it.Qty <= 0 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid item"})
				return
			}
			qtyByProduct[it.ProductID] += it.Qty
		}
		productIDs := make([]int, 0, len(qtyByProduct))
		for pid := range qtyByProduct {
			productIDs = append(productIDs, pid)
		}
		sort.Ints(productIDs)

		// ② 단일 트랜잭션: 재고 원자 차감 + order + order_items (부분 실패 시 전체 롤백)
		items := make([]lineItem, 0, len(productIDs))
		totalKRW := 0
		tx, err := db.Begin()
		if err != nil {
			respondDBError(c, err)
			return
		}
		defer tx.Rollback() // 커밋 후 no-op

		for _, pid := range productIDs {
			qty := qtyByProduct[pid]
			var title string
			var priceKRW int
			err = tx.QueryRow(`
				UPDATE products SET stock = stock - $1, updated_at = NOW()
				WHERE id = $2 AND status = 'listed' AND stock >= $1
				RETURNING title, COALESCE(sale_price_krw, 0)
			`, qty, pid).Scan(&title, &priceKRW)
			if err == sql.ErrNoRows {
				// 원인 구분: 미존재/비listed vs 재고부족
				var st string
				var stk int
				serr := tx.QueryRow(`SELECT status, COALESCE(stock, 0) FROM products WHERE id = $1`, pid).Scan(&st, &stk)
				if serr == sql.ErrNoRows {
					c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("product %d not found", pid)})
					return
				}
				if serr != nil {
					respondDBError(c, serr)
					return
				}
				if st != "listed" {
					c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("product %d is not listed", pid)})
					return
				}
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("product %d has insufficient stock", pid)})
				return
			}
			if err != nil {
				respondDBError(c, err)
				return
			}
			items = append(items, lineItem{productID: pid, title: title, priceKRW: priceKRW, qty: qty})
			totalKRW += priceKRW * qty
		}

		// ③ KRW → USDC (마이크로)
		totalUsdcMicro := krwToUsdcMicro(totalKRW)

		// ④ order 생성 (pending) + order_items — 같은 트랜잭션
		//    ship_* 7컬럼 포함 (배송지 없으면 NULL — 과거와 동일한 동작)
		insertArgs := []interface{}{userID, wallet, totalKRW, totalUsdcMicro}
		insertArgs = append(insertArgs, shippingArgs(shipping)...)

		var order models.Order
		err = scanOrderInto(tx.QueryRow(`
			INSERT INTO orders (user_id, wallet_address, status, total_krw, total_usdc_micro,
			                    ship_name, ship_phone, ship_address1, ship_address2, ship_city, ship_state, ship_zip)
			VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, $10, $11)
			RETURNING `+orderSelectColumns+`
		`, insertArgs...), &order)
		if err != nil {
			respondDBError(c, err)
			return
		}

		for _, it := range items {
			_, err := tx.Exec(`
				INSERT INTO order_items (order_id, product_id, title, price_krw, qty)
				VALUES ($1, $2, $3, $4, $5)
			`, order.ID, it.productID, it.title, it.priceKRW, it.qty)
			if err != nil {
				respondDBError(c, err)
				return
			}
		}

		if err := tx.Commit(); err != nil {
			respondDBError(c, err)
			return
		}

		// ⑤ gateway register (reference_id = orderReference — "shop_dd-N" 네임스페이스, 온체인 orderId 충돌 방지)
		//    실패해도 pending 유지 (no-downtime 원칙)
		gatewayOrderID := ""
		if gwResult, gwErr := registerWithGateway(orderReference(order.ID), wallet, totalUsdcMicro); gwErr == nil {
			if oid, ok := gwResult["order_id"].(string); ok {
				gatewayOrderID = oid
			}
			_, err = db.Exec(`
				UPDATE orders SET status = 'registered', gateway_order_id = $1, updated_at = NOW()
				WHERE id = $2
			`, gatewayOrderID, order.ID)
			if err != nil {
				respondDBError(c, err)
				return
			}
			order.Status = "registered"
			order.GatewayOrderID = gatewayOrderID
		} else {
			// 게이트웨이 미기동 — pending 유지, 클라이언트에 안내
			c.JSON(http.StatusCreated, models.CreateOrderResponse{
				OrderID:         order.ID,
				AmountUsdcMicro: totalUsdcMicro,
				GatewayOrderID:  gatewayOrderID,
				ContractAddress: os.Getenv("PAYMENT_CONTRACT_ADDRESS"),
				UsdcToken:       os.Getenv("USDC_TOKEN_ADDRESS"),
			})
			return
		}

		c.JSON(http.StatusCreated, models.CreateOrderResponse{
			OrderID:         order.ID,
			AmountUsdcMicro: totalUsdcMicro,
			GatewayOrderID:  gatewayOrderID,
			ContractAddress: os.Getenv("PAYMENT_CONTRACT_ADDRESS"),
			UsdcToken:       os.Getenv("USDC_TOKEN_ADDRESS"),
		})
	}
}

// VerifyOrder — POST /api/orders/:id/verify (JWT, owner)
// gateway verify → paymentMatchesGateway 통과 시 status=paid + tx_hash 저장.
func VerifyOrder(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _ := c.Get("userId")
		id, err := strconv.Atoi(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order ID"})
			return
		}

		var order models.Order
		err = scanOrderInto(db.QueryRow(`
			SELECT `+orderSelectColumns+`
			FROM orders WHERE id = $1
		`, id), &order)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "order not found"})
			return
		}
		if err != nil {
			respondDBError(c, err)
			return
		}
		if order.UserID != userID {
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
			return
		}

		// gateway 온체인 검증
		gatewayResult, gwErr := verifyWithGateway(orderReference(order.ID))
		if gwErr != nil {
			c.JSON(http.StatusOK, gin.H{"order": order, "verifyError": gwErr.Error()})
			return
		}
		if verified, _ := gatewayResult["verified"].(bool); verified {
			txHash, _ := gatewayResult["tx_hash"].(string)
			if !paymentMatchesGateway(gatewayResult, &order) {
				c.JSON(http.StatusOK, gin.H{"order": order, "verifyError": "on-chain amount or payer does not match the recorded order"})
				return
			}
			// CWE-754: 상태 전이 가드 — 이미 paid인 주문은 재검증으로 덮어쓰지 않음 (멱등)
			res, err := db.Exec(
				"UPDATE orders SET status = 'paid', tx_hash = $1, updated_at = NOW() WHERE id = $2 AND status <> 'paid'",
				txHash, order.ID,
			)
			if err != nil {
				respondDBError(c, err)
				return
			}
			if n, _ := res.RowsAffected(); n > 0 {
				order.Status = "paid"
				order.TxHash = txHash
			} else {
				// 이미 paid — DB의 기존 상태를 재조회해 응답 오염 방지
				_ = scanOrderInto(db.QueryRow(`
					SELECT `+orderSelectColumns+`
					FROM orders WHERE id = $1
				`, order.ID), &order)
			}
		}

		c.JSON(http.StatusOK, gin.H{"order": order})
	}
}

// GetOrders — GET /api/orders (JWT)
// 현재 사용자의 주문 목록.
func GetOrders(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, exists := c.Get("userId")
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			return
		}

		rows, err := db.Query(`
			SELECT `+orderSelectColumns+`
			FROM orders WHERE user_id = $1
			ORDER BY id DESC
		`, userID)
		if err != nil {
			respondDBError(c, err)
			return
		}
		defer rows.Close()

		orders := []models.Order{}
		for rows.Next() {
			var o models.Order
			if err := scanOrderInto(rows, &o); err != nil {
				respondDBError(c, err)
				return
			}
			orders = append(orders, o)
		}

		c.JSON(http.StatusOK, gin.H{"orders": orders})
	}
}

// GetOrder — GET /api/orders/:id (JWT, owner)
// 단일 주문 + items.
func GetOrder(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _ := c.Get("userId")
		id, err := strconv.Atoi(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order ID"})
			return
		}

		var order models.Order
		err = scanOrderInto(db.QueryRow(`
			SELECT `+orderSelectColumns+`
			FROM orders WHERE id = $1
		`, id), &order)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "order not found"})
			return
		}
		if err != nil {
			respondDBError(c, err)
			return
		}
		if order.UserID != userID {
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
			return
		}

		// items 로드
		itemRows, err := db.Query(`
			SELECT id, order_id, product_id, title, price_krw, qty
			FROM order_items WHERE order_id = $1
		`, order.ID)
		if err != nil {
			respondDBError(c, err)
			return
		}
		defer itemRows.Close()

		items := []models.OrderItem{}
		for itemRows.Next() {
			var it models.OrderItem
			if err := itemRows.Scan(&it.ID, &it.OrderID, &it.ProductID, &it.Title, &it.PriceKRW, &it.Qty); err != nil {
				respondDBError(c, err)
				return
			}
			items = append(items, it)
		}
		order.Items = items

		c.JSON(http.StatusOK, gin.H{"order": order})
	}
}
