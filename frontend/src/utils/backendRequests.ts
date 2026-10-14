import {
  MessageToClientKind,
  type MessageToClient,
  type MessageToServer,
} from "../../../common/types";
import { nextRequestId } from "./misc";

type PendingRequest = {
  resolve: (response: MessageToClient) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

// Replies are handled as socket events, rather than render effects: several
// replies may arrive before React renders, and each must settle its own request.
export class BackendRequests {
  private pending = new Map<string, PendingRequest>();

  constructor(private readonly timeoutMs = 60000) {}

  send(
    message: Omit<MessageToServer, "requestId">,
    send: (message: MessageToServer) => void,
  ): Promise<MessageToClient> {
    const requestId = nextRequestId(message.kind);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new Error(
            "The server did not confirm this request. Check the current state before trying again.",
          ),
        );
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timeout });
      try {
        send({ ...message, requestId });
      } catch (error) {
        this.finish(requestId)?.reject(
          error instanceof Error ? error : new Error("Unable to send request."),
        );
      }
    });
  }

  receive(message: MessageToClient): boolean {
    if (
      !message.requestId ||
      (message.kind !== MessageToClientKind.Success &&
        message.kind !== MessageToClientKind.Error)
    )
      return false;
    const pending = this.finish(message.requestId);
    if (!pending) return false;
    if (message.kind === MessageToClientKind.Error) {
      pending.reject(
        new Error(
          typeof message.data === "string"
            ? message.data
            : "The backend rejected the request.",
        ),
      );
    } else {
      pending.resolve(message);
    }
    return true;
  }

  disconnect(
    reason = "Connection lost before the server confirmed this request. Reconnect to check the current state.",
  ) {
    for (const requestId of this.pending.keys()) {
      this.finish(requestId)?.reject(new Error(reason));
    }
  }

  private finish(requestId: string) {
    const pending = this.pending.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pending.delete(requestId);
    }
    return pending;
  }
}
