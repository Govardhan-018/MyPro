import type { LibraryItem, TocChapter } from "../types/library";

export const creativeActToc: TocChapter[] = [
  { id: "ch-1", part: "Part I: Looking", title: "1. Seeds", page: 1, preview: "Seeds are thoughts, impressions, and moments that enter awareness." },
  { id: "ch-2", part: "Part I: Looking", title: "2. How to Notice", page: 14, preview: "The ability to look deeply is the foundation of artistic practice." },
  { id: "ch-3", part: "Part I: Looking", title: "3. Vessel and Filter", page: 36, preview: "We are receivers of energy, filters of the world around us." },
  { id: "ch-7", part: "Part II: Experimentation", title: "7. The Unseen", page: 78, preview: "Much of what moves us in art comes from what is not stated." },
  { id: "ch-12", part: "Part II: Experimentation", title: "12. Beginner's Mind", page: 102, preview: "To approach the canvas without preconception is true innocence." },
  { id: "ch-18", part: "Part III: Crafting", title: "18. Attention as a Practice", page: 128, preview: "The quality of attention changes the quality of the work itself." },
  { id: "ch-24", part: "Part III: Crafting", title: "24. Completing the Work", page: 210, preview: "A work is never truly finished; it is simply released." },
  { id: "ch-31", part: "Part IV: Liberation", title: "31. Freedom and Stillness", page: 302, preview: "Creative freedom is the absence of resistance." },
];

export interface BookPageContent {
  pageNumber: number;
  chapterTitle: string;
  partTitle?: string;
  quote?: string;
  quoteAuthor?: string;
  paragraphs: string[];
  diagram?: {
    title: string;
    caption: string;
    type: "circle-flow" | "attention-field" | "filter-model";
  };
}

export const sampleBookPages: Record<number, BookPageContent> = {
  128: {
    pageNumber: 128,
    chapterTitle: "Chapter 18 · Attention as a Practice",
    partTitle: "Part III: Crafting",
    quote: "The quality of attention changes the quality of the work itself.",
    paragraphs: [
      "Where we direct our attention determines the reality we inhabit. In any given moment, millions of stimuli surround us—the resonance of a room, the angle of afternoon light through frosted glass, the cadence of distant footsteps.",
      "Most of our days are spent skimming across the surface of perception. But artistic creation asks for something different: deliberate, non-judgmental presence.",
      "Look for what you notice but no one else seems to see. Your unique perspective is not something you fabricate; it is simply the byproduct of honest attention. When you sit with an idea without forcing it to become something immediately useful, its true nature begins to reveal itself."
    ],
    diagram: {
      title: "Perception & Attunement",
      caption: "Natural visual diagram: Preserved in high fidelity without indiscriminate inversion.",
      type: "attention-field"
    }
  },
  129: {
    pageNumber: 129,
    chapterTitle: "Chapter 18 · Attention as a Practice",
    partTitle: "Part III: Crafting",
    paragraphs: [
      "Patience is not the absence of action; it is timing. When practicing deep attention, you learn to wait for the resonant chord. If a sentence feels false, or if a design feels overcrowded with extraneous ornaments, removing an element is often more generative than adding one.",
      "Consider the space between notes. In music, silence gives weight to sound. In visual work, margins and negative space grant dignity to the subject. We often fear emptiness because it asks us to confront our own internal restlessness.",
      "By returning to the work with calm clarity each morning, we invite simplicity back into the process. The work breathes when we stop suffocating it with urgency."
    ]
  },
  130: {
    pageNumber: 130,
    chapterTitle: "Chapter 18 · Attention as a Practice",
    partTitle: "Part III: Crafting",
    quote: "To listen without preconceived answers is the highest form of respect.",
    paragraphs: [
      "When collaborating, listen not to defend your prior taste, but to hear what the moment demands. The best ideas often emerge from the friction between two disparate viewpoints, provided both parties are dedicated to truth over ego.",
      "Maintain a small notebook or a quiet digital journal. Record raw phrases, sensory textures, and spontaneous observations. Over weeks and months, these scattered fragments coalesce into an unexpected architecture."
    ]
  },
  1: {
    pageNumber: 1,
    chapterTitle: "Chapter 1 · Seeds",
    partTitle: "Part I: Looking",
    quote: "Nothing begins as a masterpiece. Everything begins as a whisper.",
    paragraphs: [
      "We are all surrounded by seeds. They come in the form of overheard conversations, geometric shadows on concrete, or a sudden pang of memory triggered by a scent.",
      "The role of the artist is not to manufacture inspiration from thin air, but to cultivate fertile ground so that when a seed drifts past, it finds soil where it can take root.",
      "Do not evaluate a seed when it first appears. If you judge a sapling on its first day, you may mistake its vulnerability for weakness."
    ]
  },
  14: {
    pageNumber: 14,
    chapterTitle: "Chapter 2 · How to Notice",
    partTitle: "Part I: Looking",
    paragraphs: [
      "Look closely at the things you take for granted. The grain of wood on your desk, the rhythm of your breath, the slight change in temperature when clouds drift across the sun.",
      "Training your perception is like tuning a delicate instrument. The finer the tuning, the broader the spectrum of harmony you can detect."
    ]
  }
};

export const initialEnhancedLibraryItems: LibraryItem[] = [
  {
    id: "item-creative-act",
    title: "The Creative Act",
    creator: "Rick Rubin",
    type: "Books",
    status: "In Progress",
    progress: 40, // 128 / 320 = 40%
    accessed: "Today",
    tone: "lavender",
    image: "https://covers.openlibrary.org/b/isbn/9780593652886-M.jpg",
    currentPage: 128,
    totalPages: 320,
    pdfFileName: "The-Creative-Act-Rick-Rubin.pdf",
    pdfStorageOption: "device",
    syncStatus: "local",
    fileSizeBytes: 5033164,
    fileSizeFormatted: "4.8 MB",
    lastReadDate: "Today, 8:20 AM",
    toc: creativeActToc,
    bookmarks: [
      { id: "bm-1", page: 14, title: "How to Notice", createdAt: "May 18" },
      { id: "bm-2", page: 128, title: "Attention as a Practice", createdAt: "Today, 8:20 AM" },
    ],
    notes: [
      {
        id: "n-1",
        page: 128,
        text: "The quality of attention changes the quality of the work itself.",
        createdAt: "Today, 8:44 AM",
      },
    ],
    highlights: [
      {
        id: "hl-1",
        page: 128,
        text: "Look for what you notice but no one else seems to see.",
        color: "lavender",
      },
    ],
  },
  {
    id: "item-thinking-in-systems",
    title: "Thinking in Systems",
    creator: "Donella H. Meadows",
    type: "Books",
    status: "In Progress",
    progress: 72,
    accessed: "Yesterday",
    tone: "blue",
    image:
      "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=80&w=300&h=450",
    currentPage: 144,
    totalPages: 200,
    pdfFileName: "thinking-in-systems-meadows.pdf",
    pdfStorageOption: "sync",
    syncStatus: "synced",
    fileSizeBytes: 8912896,
    fileSizeFormatted: "8.5 MB",
    lastSyncedAt: "Today, 11:30 AM",
    lastReadDate: "Yesterday, 4:15 PM",
  },
  {
    id: "item-design-better",
    title: "Design Better",
    creator: "Aarron Walter & Eli Woolery",
    type: "Podcasts",
    status: "In Progress",
    progress: 38, // 1475s / 3852s ≈ 38%
    accessed: "Yesterday",
    tone: "blue",
    image: "https://images.unsplash.com/photo-1449247709967-d4461a6a6103?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=80&w=600&h=600",
    youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    episodeTitle: "Designing Calm, Trustworthy Systems with John Maeda",
    podcastName: "Design Better",
    currentTimeSeconds: 1475, // 24m 35s
    durationSeconds: 3852, // 1h 04m 12s
    playbackSpeed: 1.0,
    description: "In this episode, Aarron and Eli explore how calm technology principles reduce cognitive friction, prevent alarm fatigue, and build lasting user trust."
  },
  {
    id: "item-calm-systems",
    title: "Designing Calm Systems",
    creator: "Field Notes Journal",
    type: "Articles",
    status: "Want to Read",
    progress: 18,
    accessed: "May 23",
    tone: "peach",
    image: "https://images.unsplash.com/photo-1499951360447-b19be8fe80f5?crop=entropy&cs=tinysrgb&fit=crop&fm=jpg&q=80&w=600&h=400",
    readTimeMinutes: 12,
    articleContent: "Calm technology moves smoothly between the periphery and the center of human attention. When software respects human cognitive bandwidth, it empowers decisions rather than fracturing focus..."
  },
  {
    id: "item-attention-practice",
    title: "Attention as a Practice",
    creator: "Personal note",
    type: "Notes",
    status: "Favorites",
    progress: 100,
    accessed: "May 21",
    tone: "mint",
    image: ""
  }
];
