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
		PHONE VARCHAR(255),
		EMAIL VARCHAR(255) NOT NULL UNIQUE, 
		PASSWORD VARCHAR(255) NOT NULL,
		ROLE VARCHAR(255) NOT NULL DEFAULT 'student',
		CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	);
	
	-- Quiz schema
	CREATE TABLE IF NOT EXISTS quiz (
		ID INT AUTO_INCREMENT PRIMARY KEY,
		TITLE VARCHAR(255) NOT NULL,
		DESCRIPTION TEXT NOT NULL,
		CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		DURATION INT NOT NULL, -- Duration in minutes
		START_TIME TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		CREATED_BY INT NOT NULL, -- Creator's user ID
		FOREIGN KEY (CREATED_BY) REFERENCES users(ID) ON DELETE CASCADE
	);
	
	-- Question schema
	CREATE TABLE IF NOT EXISTS question (
		ID INT AUTO_INCREMENT PRIMARY KEY,
		QUIZ_ID INT NOT NULL, -- Links to the quiz
		TITLE TEXT NOT NULL,
		CORRECT_OPTION VARCHAR(100) NOT NULL, -- Correct option identifier (e.g., 'A')
		OPTIONS JSON NOT NULL, -- JSON array of options (e.g., ["A", "B", "C", "D"])
		FOREIGN KEY (QUIZ_ID) REFERENCES quiz(ID) ON DELETE CASCADE
	);
	
	-- Responses schema
	CREATE TABLE IF NOT EXISTS response (
		ID INT AUTO_INCREMENT PRIMARY KEY,
		USER_ID INT NOT NULL, -- The user who answered
		QUIZ_ID INT NOT NULL, -- Links to the quiz
		QUESTION_ID INT NOT NULL, -- Links to the question
		SELECTED_OPTION VARCHAR(100) NOT NULL, -- User's chosen option
		IS_CORRECT BOOLEAN NOT NULL, -- Whether the answer was correct
		SUBMITTED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (USER_ID) REFERENCES users(ID) ON DELETE CASCADE,
		FOREIGN KEY (QUIZ_ID) REFERENCES quiz(ID) ON DELETE CASCADE,
		FOREIGN KEY (QUESTION_ID) REFERENCES question(ID) ON DELETE CASCADE
	);
	`
	_, err := db.Exec(query)
	if err != nil {
		log.Fatalf("Failed to execute migration: %v", err)
	}
	log.Println("AutoMigrate: Tables created or already exist.")
}
