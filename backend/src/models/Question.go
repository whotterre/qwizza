package models

// Data model for a question in a quiz 
type Question struct {
	ID            int      `json:"question_id"`  // Unique ID for the question
	Title         string   `json:"question_title"` // The text of the question
	CorrectOption string   `json:"correct_option"` // The correct answer for the question
	Options       []string 	`json:"options"`        // Possible answer options (for multiple choice)
}