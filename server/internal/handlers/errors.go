package handlers

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

// respondDBError logs the detailed database driver error to the server log and
// returns a generic 500 response to the client. This prevents leaking DBMS
// type, internal table names, and constraint names (CWE-209) via err.Error().
func respondDBError(c *gin.Context, err error) {
	log.Printf("database error: %v", err)
	c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
}
