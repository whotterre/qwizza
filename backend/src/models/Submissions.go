package models

// Data model for a submission
type Submission struct {
	ID          int     `json:"submission_id"`
	UserID      int     `json:"user_id"`      // Reference to the user submitting the quiz
	QuizID      int     `json:"quiz_id"`      // Reference to the quiz being taken
	Score       float64 `json:"score"`        // Score for the quiz submission
	SubmittedAt string  `json:"submitted_at"` // Timestamp of submission
}
