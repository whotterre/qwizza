export type Quiz = {
    q_id: number;
    game_id: number;
    title: string | null;
    created_at: Date;
}

export type Question = {
    qu_id: number;
    quiz_id: number;
    content: string;
    correct_answer: string;
}

export type Answer = {
    a_id: number;
    qu_id: number;
    content:string
}

export type QuestionWithAnswers = {
    qu_id: number;
    quiz_id: number;
    content: string;
    correct_answer: string;
    answers: Answer[];
};
