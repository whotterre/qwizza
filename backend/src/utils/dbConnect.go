package utils

import (
	"database/sql"
	_ "github.com/go-sql-driver/mysql" 
	"fmt"
	"log"
)
// Database cursor instance 
var DB *sql.DB

// Utility to connect to the database
func ConnectToDB(db_url string) {
	
	db, err := sql.Open("mysql", db_url)
	if err != nil {
		log.Fatal("Couldn't connect to database", err)
	}

	if err := DB.Ping(); err != nil {
		log.Fatal(err)
	}
	DB = db
	fmt.Println("Successfully connected to the database")
}
