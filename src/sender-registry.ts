import { SmsSdkError, SmsSenderNotFoundError } from "./errors.js";
import type { OwnedSender } from "./types.js";

/**
 * Registry of owned senders. Enforces the core invariant: a phone number is
 * bound to exactly one provider. Registering a second sender for the same
 * number (regardless of provider) throws `duplicate_sender_binding`.
 */
export class SenderRegistry {
  private byId = new Map<string, OwnedSender>();
  private byPhone = new Map<string, OwnedSender>();
  private byAlias = new Map<string, OwnedSender>();

  constructor(senders: OwnedSender[] = []) {
    for (const s of senders) this.register(s);
  }

  register(sender: OwnedSender): this {
    if (!sender.id) throw new SmsSdkError("OwnedSender.id is required", "unregistered_sender");
    if (!sender.phoneNumber) throw new SmsSdkError("OwnedSender.phoneNumber is required", "unregistered_sender");
    if (!sender.provider) throw new SmsSdkError("OwnedSender.provider is required", "unregistered_sender");

    if (this.byId.has(sender.id)) {
      throw new SmsSdkError(`Sender id "${sender.id}" is already registered`, "duplicate_sender_binding");
    }
    const existingForPhone = this.byPhone.get(sender.phoneNumber);
    if (existingForPhone) {
      throw new SmsSdkError(
        `Phone number ${sender.phoneNumber} is already bound to provider "${existingForPhone.provider}" ` +
          `(sender "${existingForPhone.id}"). A number can only live with one provider.`,
        "duplicate_sender_binding",
      );
    }
    if (sender.alias && this.byAlias.has(sender.alias)) {
      throw new SmsSdkError(`Sender alias "${sender.alias}" is already in use`, "duplicate_sender_binding");
    }

    this.byId.set(sender.id, sender);
    this.byPhone.set(sender.phoneNumber, sender);
    if (sender.alias) this.byAlias.set(sender.alias, sender);
    return this;
  }

  getById(id: string): OwnedSender | undefined {
    return this.byId.get(id);
  }

  getByPhone(phoneNumber: string): OwnedSender | undefined {
    return this.byPhone.get(phoneNumber);
  }

  /** Resolve by id, alias, or phone number (in that order). */
  find(selector: string): OwnedSender | undefined {
    return this.byId.get(selector) ?? this.byAlias.get(selector) ?? this.byPhone.get(selector);
  }

  /** Like {@link find} but throws when unresolved. */
  resolve(selector: string): OwnedSender {
    const sender = this.find(selector);
    if (!sender) {
      throw new SmsSenderNotFoundError(
        `No owned sender registered for selector "${selector}"`,
        "unregistered_sender",
      );
    }
    return sender;
  }

  list(): OwnedSender[] {
    return [...this.byId.values()];
  }
}

export function createSenderRegistry(senders: OwnedSender[] = []): SenderRegistry {
  return new SenderRegistry(senders);
}
