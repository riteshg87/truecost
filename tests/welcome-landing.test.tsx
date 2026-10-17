// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthValue } from "../lib/auth/provider";
import Welcome from "../app/page";
import SignInPage from "../app/signin/page";

const router = { push: vi.fn(), replace: vi.fn() };
let authValue: Pick<AuthValue, "viewer" | "ready" | "continueAsGuest" | "cancelVerification">;
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({ useRouter: () => router, useSearchParams: () => searchParams }));
vi.mock("@/lib/auth/provider", () => ({ useAuth: () => authValue }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => <button type="button">Appearance</button> }));

beforeEach(() => {
  vi.clearAllMocks();
  authValue = { viewer: "anonymous", ready: false, continueAsGuest: vi.fn(), cancelVerification: vi.fn() };
  searchParams = new URLSearchParams();
});

afterEach(() => cleanup());

describe("welcome landing", () => {
  it("keeps the page visible and does not redirect while auth is loading", () => {
    render(<Welcome />);

    expect(screen.getByRole("heading", { name: "Compare the loan behind the rate." })).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Compare two loans" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("takes an anonymous visitor into the real guest comparison", async () => {
    const guestValue = { viewer: "guest" as const, ready: true, continueAsGuest: vi.fn(), cancelVerification: vi.fn() };
    const continueGuest = vi.fn(() => { authValue = guestValue; });
    authValue = {
      viewer: "anonymous",
      ready: true,
      continueAsGuest: continueGuest,
      cancelVerification: vi.fn(),
    };
    const view = render(<Welcome />);

    fireEvent.click(screen.getByRole("button", { name: "Compare two loans" }));

    expect(continueGuest).toHaveBeenCalledOnce();
    expect(router.push).toHaveBeenCalledWith("/compare");
    view.rerender(<Welcome />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(router.replace).not.toHaveBeenCalled();
    const href = screen.getByRole("link", { name: "Sign in" }).getAttribute("href");
    expect(href).toBe("/signin?next=%2Fhome");
    searchParams = new URL(href!, "https://truecost.invalid").searchParams;
    authValue = { viewer: "member", ready: true, continueAsGuest: vi.fn(), cancelVerification: vi.fn() };
    render(<SignInPage />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/home"));
  });

  it("sends an already known guest or member to the workspace after auth is ready", async () => {
    authValue = { viewer: "guest", ready: true, continueAsGuest: vi.fn(), cancelVerification: vi.fn() };
    render(<Welcome />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/home"));

    router.replace.mockClear();
    authValue = { viewer: "member", ready: true, continueAsGuest: vi.fn(), cancelVerification: vi.fn() };
    render(<Welcome />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/home"));
  });

  it("explains the before and after without inventing savings", () => {
    authValue = { viewer: "anonymous", ready: true, continueAsGuest: vi.fn(), cancelVerification: vi.fn() };
    render(<Welcome />);

    expect(screen.getByRole("heading", { name: "A lower rate is one line of the decision." })).toBeTruthy();
    expect(screen.getByText("Fees and GST")).toBeTruthy();
    expect(screen.getByText("Read APR, EMI and total cost together.")).toBeTruthy();
    expect(screen.queryByText(/₹31\.2L/)).toBeNull();
    expect(screen.getByRole("link", { name: /Loan health/ }).getAttribute("href")).toBe("/signin?next=%2Floan");
    expect(screen.getByRole("link", { name: /Prepay or invest/ }).getAttribute("href")).toBe("/signin?next=%2Fprepay");
    expect(screen.getByRole("link", { name: /Transfer \/ refinance/ }).getAttribute("href")).toBe("/signin?next=%2Floan%2Ftransfer");
  });
});
