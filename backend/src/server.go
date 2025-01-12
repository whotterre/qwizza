package main

import (
	"os"
	"qwizza/utils"
	"github.com/joho/godotenv"
)

func main() {
	godotenv.Load()
	db_string := os.Getenv("DB_STRING")
	// Connect to DB
	utils.ConnectToDB(db_string)
}