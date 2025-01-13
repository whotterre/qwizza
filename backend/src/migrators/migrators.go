package migrators

import (
	"database/sql"
	"log"
)

// AutoMigrate creates relevant tables if they don't exist
func AutoMigrate(db *sql.DB) {
	query := `
	CREATE TABLE IF NOT EXISTS users (
		ID INT AUTO_INCREMENT PRIMARY KEY,
		USERNAME VARCHAR(255) NOT NULL UNIQUE,
		PHONENUMBER VARCHAR(255) NULL,
		EMAIL VARCHAR(255) NOT NULL UNIQUE, 
		PASSWORD VARCHAR(255) NOT NULL,
		ROLE VARCHAR(255) NOT NULL DEFAULT 'student',
		CREATEDAT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	)`
	
	_, err := db.Exec(query)
	if err != nil {
		log.Fatalf("Failed to create 'users' table: %v", err)
	}
	log.Println("AutoMigrate: 'users' table created or already exists.")
}
