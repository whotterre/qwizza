package migrators

import (
	"database/sql"
	"log"
)

func AutoMigrate(db *sql.DB) {
	// User table
	usersMig := `
	CREATE TABLE IF NOT EXISTS users (
		ID INT AUTO_INCREMENT PRIMARY KEY,
		USERNAME VARCHAR(255) NOT NULL UNIQUE,
		PHONE VARCHAR(255),
		EMAIL VARCHAR(255) NOT NULL UNIQUE, 
		PASSWORD VARCHAR(255) NOT NULL,
		ROLE VARCHAR(255) NOT NULL DEFAULT 'student',
		CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	);
	`
	_, userMigErr := db.Exec(usersMig)
	if userMigErr != nil {
		log.Fatalf("Failed to create users table: %v", userMigErr)
	}
	log.Println("Automigrate: 'users' table created or already exists.")

	// Quiz table
	quizMig := `
	CREATE TABLE IF NOT EXISTS quiz (
		QUIZ_ID INT AUTO_INCREMENT PRIMARY KEY,
		TITLE VARCHAR(255) NOT NULL,
		DESCRIPTION VARCHAR(255) NOT NULL,
		CREATEDAT DATETIME,
		DURATION INT NOT NULL,
		STARTTIME DATETIME
	);
	`
	_, quizMigErr := db.Exec(quizMig)
	if quizMigErr != nil {
		log.Fatalf("Failed to create quiz table: %v", quizMigErr)
	}
	log.Println("Automigrate: 'quiz' table created or already exists.")

	// Question table
	questionMig := `
	CREATE TABLE IF NOT EXISTS question (
		QUESTION_ID INT AUTO_INCREMENT PRIMARY KEY,
		QUIZ_ID INT NOT NULL, -- Links to the quiz
		TITLE TEXT NOT NULL,
		CORRECT_OPTION VARCHAR(100) NOT NULL, -- Correct option identifier (e.g., 'A')
		OPTIONS JSON NOT NULL, -- JSON array of options (e.g., ["A", "B", "C", "D"])
		FOREIGN KEY (QUIZ_ID) REFERENCES quiz(QUIZ_ID) ON DELETE CASCADE
	);
	`
	_, questionMigErr := db.Exec(questionMig)
	if questionMigErr != nil {
		log.Fatalf("Failed to create questions table: %v", questionMigErr)
	}
	log.Println("Automigrate: 'question' table created or already exists.")

	// Responses table
	attemptMig := `
	CREATE TABLE IF NOT EXISTS response (
		ID INT AUTO_INCREMENT PRIMARY KEY,
		USER_ID INT NOT NULL, -- The user who answered
		QUIZ_ID INT NOT NULL, -- Links to the quiz
		QUESTION_ID INT NOT NULL, -- Links to the question
		SELECTED_OPTION VARCHAR(100) NOT NULL, -- User's chosen option
		IS_CORRECT BOOLEAN NOT NULL, -- Whether the answer was correct
		SUBMITTED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (USER_ID) REFERENCES users(ID) ON DELETE CASCADE,
		FOREIGN KEY (QUIZ_ID) REFERENCES quiz(QUIZ_ID) ON DELETE CASCADE,
		FOREIGN KEY (QUESTION_ID) REFERENCES question(QUESTION_ID) ON DELETE CASCADE
	);
	`
	_, attemptMigErr := db.Exec(attemptMig)
	if attemptMigErr != nil {
		log.Fatalf("Failed to create response table: %v", attemptMigErr)
	}
	log.Println("Automigrate: 'response' table created or already exists.")
}
