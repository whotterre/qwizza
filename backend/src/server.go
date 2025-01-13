package main

import (
	"net/http"
	"os"
	"qwizza/handlers"
	"qwizza/routes"
	"qwizza/utils"

	"github.com/joho/godotenv"
	//"net/http"
)

func main() {
	godotenv.Load()
	db_string := os.Getenv("DB_STRING")

	// Connect to DB
	utils.ConnectToDB(db_string)

	// HTTP Server instance
	adminMux := http.NewServeMux()
	authMux := http.NewServeMux()
	userMux := http.NewServeMux()

	routes.RegisterAdminRoutes(adminMux, utils.DB)
	routes.RegisterAuthRoutes(authMux, utils.DB)
	routes.RegisterUserRoutes(userMux, utils.DB)


	
}