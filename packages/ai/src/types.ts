import type {
  PrintPartner,
  ProductionStage,
  SalesPlatform,
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from '@bookleaf/contracts';

/** A book exactly as BookLeaf's records hold it (money in paise). */
export interface BookFacts {
  id: string;
  externalId: string;
  title: string;
  isbn: string;
  genre: string;
  stage: ProductionStage;
  publicationDate: string | null;
  mrpMinor: number | null;
  royaltyPerCopyMinor: number | null;
  copiesSold: number;
  earnedMinor: number;
  paidMinor: number;
  pendingMinor: number;
  lastPayoutDate: string | null;
  printPartner: PrintPartner | null;
  platforms: SalesPlatform[];
}

export interface AuthorFacts {
  id: string;
  externalId: string;
  name: string;
  city: string | null;
  joinedDate: string;
}

export interface ThreadMessage {
  sender: 'author' | 'admin' | 'system';
  senderName: string;
  body: string;
  createdAt: Date;
}

/** Everything Leaf may know about one ticket. Only this author's data is ever included. */
export interface TicketInput {
  id: string;
  number: string;
  subject: string;
  description: string;
  createdAt: Date;
  status: TicketStatus;
  category: TicketCategory | null;
  priority: TicketPriority | null;
  author: AuthorFacts;
  /** The book the ticket is about (null for General / Account Level). */
  book: BookFacts | null;
  /** All of the author's books — used for account-level tickets. */
  portfolio: BookFacts[];
  /** Follow-up messages after the original description, oldest first. */
  messages: ThreadMessage[];
  /** Rolling summary of messages older than the verbatim window, if one exists. */
  contextSummary: string | null;
}

export interface KnowledgeSectionInput {
  slug: string;
  title: string;
  body: string;
  categories: TicketCategory[];
  alwaysInclude: boolean;
  version: number;
  embedding: number[] | null;
}

export interface KnowledgeExampleInput {
  id: string;
  category: TicketCategory;
  query: string;
  guidance: string;
  sampleReply: string | null;
  embedding: number[] | null;
}

export interface AgentSignature {
  name: string;
  title: string | null;
}

/** Correlates AI calls with domain records in telemetry. */
export interface CallContext {
  ticketId?: string | null;
  draftId?: string | null;
}
