package main

import (
	"log"
	"os"
	"strings"

	"shop-dd/internal/database"
	"shop-dd/internal/handlers"
	"shop-dd/internal/sync"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}

	// Initialize database
	db, err := database.InitDB()
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	// Create tables if they don't exist
	if err := database.CreateTables(db); err != nil {
		log.Fatalf("Failed to create tables: %v", err)
	}

	// Start sync worker (non-blocking, 5min ticker + once at start)
	sync.Run(db)

	// Setup router
	r := gin.Default()

	// CORS configuration
	config := cors.DefaultConfig()
	config.AllowOrigins = splitEnv(os.Getenv("CORS_ORIGINS"), []string{"http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:5173"})
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization"}
	config.AllowCredentials = true
	r.Use(cors.New(config))

	// API routes
	api := r.Group("/api")
	{
		// Auth routes (public)
		auth := api.Group("/auth")
		{
			auth.POST("/nonce", handlers.WalletNonce(db))
			auth.POST("/verify", handlers.WalletVerify(db))
		}

		// Products routes (public)
		api.GET("/products", handlers.GetProducts(db))
		api.GET("/products/:id", handlers.GetProduct(db))

		// Protected routes (require authentication)
		protected := api.Group("")
		protected.Use(handlers.AuthMiddleware())
		{
			protected.POST("/orders", handlers.CreateOrder(db))
			protected.POST("/orders/:id/verify", handlers.VerifyOrder(db))
			protected.GET("/orders", handlers.GetOrders(db))
			protected.GET("/orders/:id", handlers.GetOrder(db))
		}
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8095"
	}

	log.Printf("Server starting on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func splitEnv(val string, defaults []string) []string {
	if strings.TrimSpace(val) == "" {
		return defaults
	}
	out := make([]string, 0, 8)
	for _, p := range strings.Split(val, ",") {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	if len(out) == 0 {
		return defaults
	}
	return out
}
