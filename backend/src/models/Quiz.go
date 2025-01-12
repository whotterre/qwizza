package models

import "time"

// Data model for quiz
type Quiz struct {
	ID          int        `json:"quiz_id"`
	Title       string     `json:"quiz_title"`
	Description string     `json:"description"`
	CreatedAt   time.Time  `json:"quiz_created_at"`
	Questions   []Question `json:"questions"`
	Duration    int        `json:"quiz_duration"`   // Duration in minutes
	StartTime   time.Time  `json:"quiz_start_time"`  // The time when the quiz starts
}
