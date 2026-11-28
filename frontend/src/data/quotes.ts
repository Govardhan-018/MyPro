/**
 * Motivational quotes for the Today card.
 *
 * Built to hold ~200. To add more, paste objects into `QUOTES` in the same
 * shape — give each a new, unique `id` (the next `q###`), and keep the author
 * to whoever actually said it ("Proverb" when nobody did). Order does not
 * matter: the card picks at random and never shows the same one twice in a row.
 */
export interface Quote {
  id: string;
  text: string;
  author: string;
}

export const QUOTES: Quote[] = [
  { id: "q001", text: "You do not rise to the level of your goals. You fall to the level of your systems.", author: "James Clear" },
  { id: "q002", text: "The impediment to action advances action. What stands in the way becomes the way.", author: "Marcus Aurelius" },
  { id: "q003", text: "We suffer more often in imagination than in reality.", author: "Seneca" },
  { id: "q004", text: "Waste no more time arguing what a good man should be. Be one.", author: "Marcus Aurelius" },
  { id: "q005", text: "What we fear doing most is usually what we most need to do.", author: "Tim Ferriss" },
  { id: "q006", text: "The best time to plant a tree was twenty years ago. The second best time is now.", author: "Proverb" },
  { id: "q007", text: "Do the best you can until you know better. Then when you know better, do better.", author: "Maya Angelou" },
  { id: "q008", text: "How we spend our days is, of course, how we spend our lives.", author: "Annie Dillard" },
  { id: "q009", text: "Focus is a matter of deciding what things you're not going to do.", author: "John Carmack" },
  { id: "q010", text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { id: "q011", text: "Nothing in life is to be feared, it is only to be understood.", author: "Marie Curie" },
  { id: "q012", text: "Be so good they can't ignore you.", author: "Steve Martin" },
  { id: "q013", text: "Well done is better than well said.", author: "Benjamin Franklin" },
  { id: "q014", text: "He who has a why to live can bear almost any how.", author: "Friedrich Nietzsche" },
  { id: "q015", text: "Begin at once to live, and count each separate day as a separate life.", author: "Seneca" },
  { id: "q016", text: "Knowing is not enough; we must apply. Willing is not enough; we must do.", author: "Johann Wolfgang von Goethe" },
  { id: "q017", text: "You miss one hundred percent of the shots you don't take.", author: "Wayne Gretzky" },
  { id: "q018", text: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", author: "Will Durant" },
  { id: "q019", text: "If you want to go fast, go alone. If you want to go far, go together.", author: "Proverb" },
  { id: "q020", text: "A year from now you may wish you had started today.", author: "Karen Lamb" },
  // ↓ Paste more quotes here, continuing from q021.
];
