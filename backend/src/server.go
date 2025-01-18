package main

import (
	"log"
	"net/http"
	"os"
	"qwizza/migrators"
	"qwizza/routes"
	"qwizza/utils"

	"github.com/joho/godotenv"
)

func main() {
	// Load environment variables
	err := godotenv.Load()
	if err != nil {
		log.Println("Warning: No .env file found or failed to load")
	}

	// Get DB connection string from environment variables
	dbString := os.Getenv("DB_STRING")
	if dbString == "" {
		log.Fatal("Error: DB_STRING environment variable is not set")
	}

	// Connect to the database
	utils.ConnectToDB(dbString)

	// Run database migrations
	migrators.AutoMigrate(utils.DB)

	// HTTP Server instance with unified routes
	mux := http.NewServeMux()
	routes.RegisterAdminRoutes(mux, utils.DB) // Admin routes
	routes.RegisterUserRoutes(mux, utils.DB) // User routes

	// Get server port
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080" // Default to port 8080 if not set
	}

	// Start the server
	log.Printf("Starting server on port %s...", port)
	err = http.ListenAndServe(":"+port, mux)
	if err != nil {
		log.Fatalf("Error starting server: %v", err)
	}
}
