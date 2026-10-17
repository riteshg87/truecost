import { LOAN_TYPES } from "../finance/loanTypes";
import {
  contractFail,
  deepFreeze,
  exactKeys,
  integerValue,
  recordOf,
} from "./errors";
import { parseSnapshotOffer, SNAPSHOT_LIMITS } from "./snapshot";
import type { Offer } from "../finance/types";

const DRAFT_KEYS = ["loanType", "offers"] as const;

export interface CompareDraft {
  loanType: keyof typeof LOAN_TYPES;
  offers: Offer[];
}

/**
 * Drafts deliberately allow zero amount, rate, and tenure values while a guest
 * is editing. They still use the snapshot offer parser so shape, enums,
 * finite-number bounds, and nested fee limits remain identical to snapshots.
 */
export function decodeComparisonDraft(
  value: unknown,
  maxOffers: number = SNAPSHOT_LIMITS.maxOffers,
): Readonly<CompareDraft> {
  if (!Number.isInteger(maxOffers) || maxOffers < SNAPSHOT_LIMITS.minOffers || maxOffers > SNAPSHOT_LIMITS.maxOffers) {
    contractFail("invalid_number", "draft offer limit is out of bounds");
  }
  const record = recordOf(value, "draft");
  exactKeys(record, DRAFT_KEYS, "draft");
  if (!(typeof record.loanType === "string" && Object.prototype.hasOwnProperty.call(LOAN_TYPES, record.loanType))) {
    contractFail("invalid_enum", "draft.loanType is not supported");
  }
  if (!Array.isArray(record.offers) || record.offers.length < SNAPSHOT_LIMITS.minOffers || record.offers.length > maxOffers) {
    contractFail("wrong_count", "draft.offers has an invalid count");
  }
  const offers = record.offers.map((offer, index) => parseSnapshotOffer(offer, `draft.offers[${index}]`));
  if (new Set(offers.map((offer) => offer.id)).size !== offers.length) {
    contractFail("duplicate_id", "draft.offers contains duplicate IDs");
  }
  if (offers.some((offer) => offer.loanType !== record.loanType)) {
    contractFail("id_mismatch", "draft loan type does not match its offers");
  }
  return deepFreeze({ loanType: record.loanType as CompareDraft["loanType"], offers });
}

export function serializeComparisonDraft(draft: CompareDraft, maxOffers: number = SNAPSHOT_LIMITS.maxOffers): string {
  return JSON.stringify(decodeComparisonDraft(draft, maxOffers));
}
