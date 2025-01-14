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
	godotenv.Load()
	db_string := os.Getenv("DB_STRING")
	if db_string == "" {
		log.Fatal("DB_STRING environment variable is not set")
	}
	// Connect to DB
	utils.ConnectToDB(db_string)
	// Migrate 
	migrators.AutoMigrate(utils.DB)
	// HTTP Server instance
	adminMux := http.NewServeMux()
	// userMux := http.NewServeMux()

	routes.RegisterAdminRoutes(adminMux, utils.DB)
	// routes.RegisterUserRoutes(userMux, utils.DB)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting server on port %s...", port)
	err := http.ListenAndServe(":"+port, adminMux)

	if err != nil {
		log.Fatalf("Error starting server: %v", err)
	}

}
