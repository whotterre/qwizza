package utils

import (
	"database/sql"
	"fmt"
	"log"

	_ "github.com/go-sql-driver/mysql" // MySQL driver
)

// Database cursor instance
var DB *sql.DB

// ConnectToDB connects to the database and assigns the connection to the global DB variable
func ConnectToDB(dbURL string) {
	
	db, err := sql.Open("mysql", dbURL)
	if err != nil {
		log.Fatalf("Couldn't connect to the database: %v", err)
	}

	
	if err := db.Ping(); err != nil {
		log.Fatalf("Couldn't ping the database: %v", err)
	}
	DB = db
	fmt.Println("Successfully connected to the database")
}
