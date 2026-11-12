// Every word the chat shows or speaks (M2-T11). Plain, short and literal: many readers have English as a
// second language. Another language is a second object of this shape.
export const strings = {
  loading: "Loading the chat",
  close: "Close chat",
  notice: "You are chatting with an AI assistant. It can make mistakes.",
  you: "You:",
  answer: "Answer:",
  input: "Your question",
  placeholder: "Type your question",
  send: "Send",
  stop: "Stop the answer",
  working: "Finding an answer",
  stopped: "You stopped this answer.",
  copy: "Copy answer",
  copied: "Copied",
  retry: "Try again",
  newChat: "Start a new chat",
  unknownBlock: "This part of the answer cannot be shown here.",
  diagramSource: "Diagram source",
  image: (description: string) => (description ? `Image: ${description}` : "Image"),
  latest: "Go to the latest message",
  credit: "Powered by Purple Fabric",
  remaining: (left: number) => `${left} characters left`,
  reference: (id: string) => `Reference: ${id}`,
  answered: (text: string) => `Answer: ${text}`,
  problems: {
    offline: "You are offline. Check your connection, then try again.",
    unavailable: "The assistant is not available right now. Please try again in a moment.",
    busy: "Too many messages at once. Please wait a moment, then try again.",
    expired: "Your chat session has ended. Start a new chat to continue.",
    notAllowed: "This chat is not available on this website.",
    failed: "Something went wrong. Please try again.",
  },
};

export type ProblemKind = keyof typeof strings.problems;
