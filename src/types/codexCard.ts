export type CodexCardType = 'plus' | 'free';

export interface CodexCard {
  code: string;
  card_type?: string;
  cardType?: string;
  created_at?: string | number;
  redeemed_at?: string | number;
  redeemedAt?: string | number;
  redeemed?: boolean;
  redeemed_by?: string;
  status?: string;
  note?: string;
  [key: string]: unknown;
}

export interface CodexCardSummary {
  total?: number;
  redeemed?: number;
  unredeemed?: number;
  plus_total?: number;
  plus_redeemed?: number;
  plus_unredeemed?: number;
  free_total?: number;
  free_redeemed?: number;
  free_unredeemed?: number;
  [key: string]: unknown;
}

export interface CodexCardListResponse {
  cards: CodexCard[];
  summary?: CodexCardSummary;
}

export interface CodexCardGenerateResponse {
  codes?: string[];
  generated?: number;
}

export interface CodexCardImportFailure {
  code?: string;
  error?: string;
  message?: string;
}

export interface CodexCardImportResponse {
  imported?: number;
  duplicates?: string[];
  failed?: CodexCardImportFailure[];
}

export interface CodexCardDeleteResponse {
  deleted?: number;
}
