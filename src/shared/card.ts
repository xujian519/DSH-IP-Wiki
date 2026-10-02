/**
 * Card model shared by both halves.
 *
 * The Host reads these values off disk; the Client renders them. Keeping the
 * types here means the panel and the routes cannot drift apart on a field name,
 * and the wire payload is the same object the reader produced.
 * @module dsh-ip-wiki/shared/card
 */

/** The card kinds the library schema defines, in reading order. */
export const CARD_TYPES = ['concept', 'rule', 'case', 'statute'] as const

/** One card kind. */
export type CardType = (typeof CARD_TYPES)[number]

/** The lifecycle values a card's frontmatter may carry, in reading order. */
export const CARD_STATUSES = ['draft', 'confirmed', 'deprecated'] as const

/** Lifecycle a card is in. */
export type CardStatus = (typeof CARD_STATUSES)[number]

/** Titles the panel shows for each kind. */
export const CARD_TYPE_LABEL: Readonly<Record<CardType, string>> = {
  concept: '概念卡',
  rule: '规则卡',
  case: '案例卡',
  statute: '法条卡',
}

/**
 * Narrow arbitrary frontmatter text to a known card kind.
 * @param value - the `type` field as read from disk.
 * @returns the kind, or `undefined` when the field is absent or unknown.
 */
export function asCardType(value: string | undefined): CardType | undefined {
  return CARD_TYPES.find(candidate => candidate === value)
}

/**
 * Narrow arbitrary frontmatter text to a known lifecycle status.
 * @param value - the `status` field as read from disk.
 * @returns the status; an absent or unrecognised value means `draft`, because a card
 * that carries no confirmation has not been confirmed.
 */
export function asCardStatus(value: string | undefined): CardStatus {
  return CARD_STATUSES.find(candidate => candidate === value) ?? 'draft'
}

/** One card as the tree and lists need it: frontmatter facts, no body. */
export interface CardSummary {
  /** Stable card id from the frontmatter. */
  readonly id: string
  /** Card kind. */
  readonly type: CardType
  /** Card title. */
  readonly title: string
  /** Top-level domain; `未分类` when the card carries none. */
  readonly domainL1: string
  /** Business domain the tree groups by. */
  readonly domainL2: string
  /** Concept label, as the card records it. */
  readonly concept: string
  /** Lifecycle status. */
  readonly status: CardStatus
  /** Model confidence recorded at migration. */
  readonly confidence: number | undefined
  /** Quality score recorded at migration. */
  readonly quality: number | undefined
  /** Path relative to the library root, with `/` separators. */
  readonly path: string
  /** How many cross-references the card records. */
  readonly relatedCount: number
}

/** What a permanent card deletion did. */
export interface DeleteResult {
  /** Library-relative path of the deleted card. */
  readonly path: string
  /** The title the deleted card carried. */
  readonly title: string
  /** Cards whose `related_concepts` lost a reference to it, in library order. */
  readonly stripped: readonly string[]
  /** How many cards the library holds afterwards. */
  readonly totalCards: number
}

/** What an index rebuild reported, as the panel needs it. */
export interface IndexBuild {
  /** How many cards the index now describes. */
  readonly totalCards: number
  /** Count per card kind. */
  readonly byType: Readonly<Record<string, number>>
  /** Count per business domain. */
  readonly byDomain: Readonly<Record<string, number>>
  /** Where the previous index was kept, or empty text when there was none. */
  readonly backup: string
}

/** One card with its body and provenance, for the reader pane. */
export interface CardDocument extends CardSummary {  /** Markdown body after the frontmatter block. */
  readonly body: string
  /** Law references the card cites. */
  readonly lawRefs: readonly string[]
  /** Related card ids the card records. */
  readonly relatedConcepts: readonly string[]
  /**
   * Link targets the card points at that resolved to no card, as the import recorded
   * them. A target named here often enough is a concept the library keeps using
   * without having a card for it, which is what the gate's `wanted-card` rule reports.
   * Nothing reads these as references: `relatedConcepts` holds the ones that resolved.
   */
  readonly wikiLinks: readonly string[]
  /** Jurisdiction code. */
  readonly jurisdiction: string
  /**
   * The id this card carried before the migration, or empty text. Cross-references
   * written before the migration point at this id, not at the card's own.
   */
  readonly fromId: string
  /**
   * The card that absorbed this one when duplicates were merged, or empty text.
   * A card carrying this is kept as history and is `deprecated`.
   */
  readonly supersededBy: string
  /** Where the card came from, when the card records it. */
  readonly sourcePath: string
  /** Whether the migration flagged the card for human review. */
  readonly needsReview: boolean
}

/** One group of cards in the panel's tree. */
export interface CardGroup {
  /** Stable key for React and for expansion state. */
  readonly key: string
  /** Label the tree shows. */
  readonly label: string
  /** Cards in this group, title-ordered. */
  readonly cards: readonly CardSummary[]
}

/** One kind's groups, in panel order. */
export interface CardTypeBranch {
  /** Card kind this branch holds. */
  readonly type: CardType
  /** Label the tree shows. */
  readonly label: string
  /** Groups of this kind. */
  readonly groups: readonly CardGroup[]
  /** Total cards under this branch. */
  readonly total: number
}

/** Counts the status strip shows. */
export interface LibraryCounts {
  /** Total cards read from disk. */
  readonly total: number
  /** Count per card kind. */
  readonly byType: Readonly<Record<string, number>>
  /** Count per business domain. */
  readonly byDomain: Readonly<Record<string, number>>
  /** Count per lifecycle status. */
  readonly byStatus: Readonly<Record<string, number>>
}

/** How the on-disk index compares with what the reader found. */
export type IndexDrift = 'none' | 'missing' | 'count-mismatch' | 'unreadable'

/** A card queued for human review; it always carries the confidence that queued it. */
export interface ReviewCard extends CardSummary {
  /** Model confidence recorded at migration. */
  readonly confidence: number
}

/** What the panel header reports about the library. */
export interface LibraryStatus {
  /** Absolute library root the Host is reading. */
  readonly root: string
  /** Whether that directory exists and is a directory. */
  readonly exists: boolean
  /** Counts over the cards read from disk. */
  readonly counts: LibraryCounts
  /** `generated_at` of `index/card-index.json`, when it is readable. */
  readonly indexGeneratedAt: string | undefined
  /** `total_cards` of `index/card-index.json`, when it is readable. */
  readonly indexTotalCards: number | undefined
  /** Whether the index agrees with the cards on disk. */
  readonly indexDrift: IndexDrift
  /** Report file names under `reports/`, sorted. */
  readonly reports: readonly string[]
  /** Cards the migration flagged for human review. */
  readonly needsReview: readonly ReviewCard[]
  /** Why the root is unusable, or empty text when the library reads fine. */
  readonly problem: string
}

/** One report file's text. */
export interface ReportDocument {
  /** File name relative to `reports/`. */
  readonly name: string
  /** Whole file text. */
  readonly text: string
}

/** The tree payload the panel fetches once. */
export interface LibraryTree {
  /** Status strip data. */
  readonly status: LibraryStatus
  /** Branches in panel order. */
  readonly branches: readonly CardTypeBranch[]
}

/** Which retrieval stage produced a hit's place in the result. */
export type SearchMode = 'keyword' | 'vector' | 'rerank'

/** One search hit, with everything a citation needs. */
export interface SearchHit {
  /** The card's library-relative path. */
  readonly path: string
  /** Card title. */
  readonly title: string
  /** Card kind. */
  readonly type: CardType
  /** Business domain. */
  readonly domainL2: string
  /** Concept label. */
  readonly concept: string
  /** Law references the card cites. */
  readonly lawRefs: readonly string[]
  /** Where the card came from. */
  readonly sourcePath: string
  /** Lifecycle status, so a caller can tell an unconfirmed card from a confirmed one. */
  readonly status: CardStatus
  /** Score from the stage that ordered it. */
  readonly score: number
  /** Stages that found or ranked this hit, in the order they ran. */
  readonly matched: readonly SearchMode[]
  /** The most query-like excerpt of the card. */
  readonly snippet: string
}

/** One search answer. */
export interface SearchResult {
  /** The query as it was run, trimmed. */
  readonly query: string
  /** The strongest stage that actually ordered the hits. */
  readonly mode: SearchMode
  /** Why a stronger stage did not run, or empty text when nothing degraded. */
  readonly degraded: string
  /** How many cards the search read. */
  readonly scanned: number
  /**
   * How many of the scanned cards are deprecated. Those cards still appear among
   * the hits, but only after every live card, so a superseded card never answers
   * ahead of the card that replaced it.
   */
  readonly deprecated: number
  /**
   * How many candidates the search moved behind the distinct hits because they repeat
   * one already in the list. Those cards still appear, but after every card that says
   * something the list does not already carry.
   */
  readonly duplicates: number
  /** Hits, best first. */
  readonly hits: readonly SearchHit[]
}

/** Whether semantic retrieval is available. */
export interface SearchStatus {
  /** Whether the embedding stages can run. */
  readonly semantic: boolean
  /** Why they cannot, or empty text when they can. */
  readonly reason: string
  /** The embedding model in use, or empty text when none is configured. */
  readonly embedModel: string
  /** How many cards the last embedding round found a vector for. */
  readonly warmed: number
  /** How many cards that round covered; zero before any round has run. */
  readonly total: number
}
