import { LocatorStrategy } from "./actions";

/**
 * Normalized Interactive Element definition for token-efficient DOM representation
 * Adheres strictly to Section 7 (Compact, normalized page representation)
 */
export interface ObservedElement {
  id: string; // generated unique reference on the page
  role?: string;
  tagName: string;
  type?: string;
  name?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  value?: string;
  href?: string;
  testId?: string;
  isVisible: boolean;
  isEnabled: boolean;
  isChecked?: boolean;
  isSelected?: boolean;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  attributes?: Record<string, string>;
  locatorCandidates: Array<{
    strategy: (typeof LocatorStrategy)[keyof typeof LocatorStrategy];
    value: string;
    confidence: number;
  }>;
}

/**
 * Normalized Page Observation
 */
export interface PageObservation {
  url: string;
  title: string;
  headings: string[];
  interactiveElements: ObservedElement[];
  forms: Array<{
    id?: string;
    action?: string;
    inputs: string[];
  }>;
  dialogs: Array<{
    type: "alert" | "confirm" | "prompt" | "modal";
    message: string;
  }>;
  summary: string;
  timestamp: string;
  tabId: string;
}

/**
 * Multi-tab Context Tracking (Section 17)
 */
export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  isActive: boolean;
  createdAt: string;
}

export interface BrowserSessionState {
  tabs: BrowserTab[];
  activeTabId: string;
  viewport: {
    width: number;
    height: number;
  };
  isHeadless: boolean;
}
