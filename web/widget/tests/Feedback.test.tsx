import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { Feedback } from "../src/Feedback";
import { strings as t } from "../src/strings";

afterEach(cleanup);

const setup = (rate = vi.fn().mockResolvedValue(undefined), initial: "like" | "dislike" | null = null) => {
  const say = vi.fn();
  render(<Feedback initial={initial} rate={rate} say={say} />);
  return { rate, say };
};

test("a thumb saves the rating at once, then a comment can follow and is thanked for", async () => {
  const { rate, say } = setup();

  fireEvent.click(screen.getByRole("button", { name: t.rate.dislike }));

  expect(rate).toHaveBeenCalledWith("dislike");
  expect(screen.getByRole("button", { name: t.rate.dislike }).getAttribute("aria-pressed")).toBe("true");
  const field = screen.getByLabelText(t.feedbackAsk.dislike);
  expect(document.activeElement).toBe(field);
  expect(screen.getByRole("button", { name: t.feedbackSend })).toHaveProperty("disabled", true);

  fireEvent.change(field, { target: { value: "  It gave the summer hours.  " } });
  fireEvent.click(screen.getByRole("button", { name: t.feedbackSend }));

  await waitFor(() => expect(say).toHaveBeenCalledWith(t.feedbackThanks));
  expect(rate).toHaveBeenLastCalledWith("dislike", "It gave the summer hours.");
  expect(screen.queryByLabelText(t.feedbackAsk.dislike)).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: t.rate.dislike }));
});

test("the chosen thumb again takes the rating back, and the other thumb switches it", async () => {
  const { rate } = setup(undefined, "like");
  const like = screen.getByRole("button", { name: t.rate.like });
  expect(like.getAttribute("aria-pressed")).toBe("true");

  fireEvent.click(like);
  await waitFor(() => expect(rate).toHaveBeenCalledWith(null));
  expect(like.getAttribute("aria-pressed")).toBe("false");
  expect(screen.queryByRole("textbox")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: t.rate.dislike }));
  expect(rate).toHaveBeenLastCalledWith("dislike");
});

test("Escape closes the card without reaching the chat, keeping the rating", () => {
  setup();
  const outside = vi.fn();
  window.addEventListener("keydown", outside);
  fireEvent.click(screen.getByRole("button", { name: t.rate.like }));

  fireEvent.keyDown(screen.getByLabelText(t.feedbackAsk.like), { key: "Escape" });

  expect(screen.queryByLabelText(t.feedbackAsk.like)).toBeNull();
  expect(outside).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: t.rate.like }).getAttribute("aria-pressed")).toBe("true");
  window.removeEventListener("keydown", outside);
});

test("a rating that could not be saved is undone and the visitor is told", async () => {
  const { say } = setup(vi.fn().mockRejectedValue(new Error("offline")));

  fireEvent.click(screen.getByRole("button", { name: t.rate.like }));

  await waitFor(() => expect(say).toHaveBeenCalledWith(t.feedbackFailed));
  expect(screen.getByRole("button", { name: t.rate.like }).getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByText(t.feedbackFailed)).toBeTruthy();
});
