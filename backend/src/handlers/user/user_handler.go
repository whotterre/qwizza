package handlers

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"qwizza/models"
)

// Gets all quizzes with questions and options
func GetQuizzes(dbi *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Invalid request method", http.StatusMethodNotAllowed)
			return
		}

		query := `
			SELECT q.QUIZ_ID, q.TITLE, q.DESCRIPTION, q.CREATEDAT, q.DURATION, q.STARTTIME,
			       qs.QUESTION_ID, qs.TITLE, qs.CORRECT_OPTION, qs.OPTIONS
			FROM quiz q
			LEFT JOIN question qs ON q.QUIZ_ID = qs.QUIZ_ID;
		`
		rows, err := dbi.Query(query)
		if err != nil {
			log.Println("Error fetching quizzes: ", err)
			http.Error(w, "Error fetching quizzes", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		quizzesMap := make(map[int]*models.Quiz)

		for rows.Next() {
			var questionID sql.NullInt64
			var optionsJSON []byte

			quiz := models.Quiz{}
			question := models.Question{}

			err := rows.Scan(
				&quiz.ID, &quiz.Title, &quiz.Description, &quiz.CreatedAt, &quiz.Duration, &quiz.StartTime,
				&questionID, &question.Title, &question.CorrectOption, &optionsJSON,
			)
			if err != nil {
				log.Println("Error scanning row: ", err)
				http.Error(w, "Error scanning row", http.StatusInternalServerError)
				return
			}

			// Unmarshal JSON options if the question exists
			if questionID.Valid {
				if err := json.Unmarshal(optionsJSON, &question.Options); err != nil {
					log.Println("Error unmarshaling OPTIONS JSON: ", err)
					http.Error(w, "Error unmarshaling options", http.StatusInternalServerError)
					return
				}
				question.ID = int(questionID.Int64)

				if _, exists := quizzesMap[quiz.ID]; !exists {
					quizzesMap[quiz.ID] = &quiz
				}
				quizzesMap[quiz.ID].Questions = append(quizzesMap[quiz.ID].Questions, question)
			}
		}

		var quizzes []models.Quiz
		for _, quiz := range quizzesMap {
			quizzes = append(quizzes, *quiz)
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(quizzes); err != nil {
			log.Println("Error encoding JSON: ", err)
			http.Error(w, "Error encoding response", http.StatusInternalServerError)
		}
	}
}

// Takes a quiz: Fetch quiz, questions, and options
func TakeQuiz(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Invalid request method", http.StatusMethodNotAllowed)
			return
		}

		quizID := r.URL.Query().Get("quiz_id")
		if quizID == "" {
			http.Error(w, "Missing quiz_id parameter", http.StatusBadRequest)
			return
		}

		// Query to get the quiz and questions with options
		query := `
			SELECT q.QUIZ_ID, q.TITLE, q.DESCRIPTION, q.CREATEDAT, q.DURATION, q.STARTTIME,
			       qs.QUESTION_ID, qs.TITLE, qs.CORRECT_OPTION, qs.OPTIONS
			FROM quiz q
			LEFT JOIN question qs ON q.QUIZ_ID = qs.QUIZ_ID
			WHERE q.QUIZ_ID = ?
		`

		rows, err := db.Query(query, quizID)
		if err != nil {
			log.Println("Error fetching quiz: ", err)
			http.Error(w, "Error fetching quiz", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		quiz := models.Quiz{}
		quizzesMap := make(map[int]*models.Quiz)

		// Loop through the rows and parse the data
		for rows.Next() {
			var questionID sql.NullInt64
			var optionsJSON []byte

			question := models.Question{}
			err := rows.Scan(
				&quiz.ID, &quiz.Title, &quiz.Description, &quiz.CreatedAt, &quiz.Duration, &quiz.StartTime,
				&questionID, &question.Title, &question.CorrectOption, &optionsJSON,
			)
			if err != nil {
				log.Println("Error scanning row: ", err)
				http.Error(w, "Error scanning row", http.StatusInternalServerError)
				return
			}

			// Unmarshal JSON options if the question exists
			if questionID.Valid {
				if err := json.Unmarshal(optionsJSON, &question.Options); err != nil {
					log.Println("Error unmarshaling OPTIONS JSON: ", err)
					http.Error(w, "Error unmarshaling options", http.StatusInternalServerError)
					return
				}
				question.ID = int(questionID.Int64)

				if _, exists := quizzesMap[quiz.ID]; !exists {
					quizzesMap[quiz.ID] = &quiz
				}
				quizzesMap[quiz.ID].Questions = append(quizzesMap[quiz.ID].Questions, question)
			}
		}

		// Check for any row iteration errors
		if err := rows.Err(); err != nil {
			log.Println("Error iterating rows: ", err)
			http.Error(w, "Error iterating rows", http.StatusInternalServerError)
			return
		}

		// Convert map to slice for JSON response
		var quizzes []models.Quiz
		for _, quiz := range quizzesMap {
			quizzes = append(quizzes, *quiz)
		}

		// Set content type and return quiz data
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(quizzes); err != nil {
			log.Println("Error encoding response: ", err)
			http.Error(w, "Error encoding response", http.StatusInternalServerError)
		}
	}
}

// Handle quiz submission with answers (POST request to submit answers)
func SubmitQuizAnswers(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Invalid request method", http.StatusMethodNotAllowed)
			return
		}

		var answers map[int]string // Map question ID to the user's answer
		if err := json.NewDecoder(r.Body).Decode(&answers); err != nil {
			http.Error(w, "Invalid JSON body", http.StatusBadRequest)
			return
		}

		// Validate the answers and return the result
		score := 0
		for questionID, userAnswer := range answers {
			// Get the correct answer for the question from the database
			query := `SELECT CORRECT_OPTION FROM question WHERE QUESTION_ID = ?`
			var correctAnswer string
			err := db.QueryRow(query, questionID).Scan(&correctAnswer)
			if err != nil {
				log.Println("Error fetching correct answer: ", err)
				http.Error(w, "Error fetching correct answer", http.StatusInternalServerError)
				return
			}

			// Check if the user's answer is correct
			if userAnswer == correctAnswer {
				score++
			}
		}

		// Respond with the user's score
		w.Header().Set("Content-Type", "application/json")
		response := map[string]int{"score": score}
		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Println("Error encoding response: ", err)
			http.Error(w, "Error encoding response", http.StatusInternalServerError)
		}
	}
}

