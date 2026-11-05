/* Backrooms Runner — community chat MVP. Requires AuthSystem and Supabase JS v2. */
"use strict";

const ChatSystem = {
  channelRows: [], currentChannel: null, subscription: null, presenceChannel: null,
  presenceTimer: null, replyTo: null, access: null, initialized: false,
  targetSearchToken: 0, onlineUserIds: new Set(),
  reactions: ["👍", "❤️", "👀", "😂", "❗"],

  init() {
    if (this.initialized) return;
    this.initialized = true;
    const back = document.getElementById("chat-back");
    if (back) back.addEventListener("click", () => { this.teardownSubscriptions(); MenuSystem.closePage(); });
    const signIn = document.getElementById("chat-signin-button");
    if (signIn) signIn.addEventListener("click", () => AuthSystem.openModal());
    const send = document.getElementById("chat-send");
    if (send) send.addEventListener("click", () => this.sendMessage());
    const cancelReply = document.getElementById("chat-reply-cancel");
    if (cancelReply) cancelReply.addEventListener("click", () => this.clearReply());
    const input = document.getElementById("chat-input");
    if (input) input.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
    });
    const appeal = document.getElementById("chat-appeal-submit");
    if (appeal) appeal.addEventListener("click", () => this.submitAppeal());
    const mod = document.getElementById("chat-mod-submit");
    if (mod) mod.addEventListener("click", () => this.moderateUser());
    const targetSearch = document.getElementById("chat-mod-search");
    if (targetSearch) targetSearch.addEventListener("input", () => this.searchModerationTargets());
    const review = document.getElementById("chat-review-refresh");
    if (review) review.addEventListener("click", () => this.loadReviewQueue());
  },

  async open() {
    this.init();
    const status = document.getElementById("chat-status");
    if (!AuthSystem || !AuthSystem.user || !AuthSystem.client) {
      this.showSignedOut();
      return;
    }
    if (status) status.textContent = "Connecting to community...";
    this.setVisible("chat-workspace", false); this.setVisible("chat-appeal", false);
    this.setVisible("chat-moderation", false); this.setVisible("chat-review", false);
    this.teardownSubscriptions();
    try {
      this.access = await this.getAccess();
      if (!this.access.can_read) { this.showAppealOnly(); return; }
      this.showChat();
      await this.loadChannels();
      await this.startPresence();
      if (AuthSystem.canModerate()) {
        const panel = document.getElementById("chat-moderation");
        if (panel) panel.hidden = false;
      }
      if (AuthSystem.canAdmin()) {
        const queue = document.getElementById("chat-review");
        if (queue) queue.hidden = false;
        await this.loadReviewQueue();
      }
    } catch (error) {
      console.error("Chat connection failed:", error);
      if (status) status.textContent = "Chat could not connect. Check that the Supabase chat migration has been run and try again.";
    }
  },

  async getAccess() {
    const { data, error } = await AuthSystem.client.rpc("chat_get_access_status");
    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
  },

  showSignedOut() {
    this.setVisible("chat-signin", true); this.setVisible("chat-workspace", false);
    this.setVisible("chat-appeal", false); this.setVisible("chat-moderation", false); this.setVisible("chat-review", false);
    const status = document.getElementById("chat-status");
    if (status) status.textContent = "Sign in to join the Backrooms Runner community.";
  },
  showChat() {
    this.setVisible("chat-signin", false); this.setVisible("chat-workspace", true);
    this.setVisible("chat-appeal", false);
    this.setVisible("chat-moderation", AuthSystem.canModerate());
    this.setVisible("chat-review", AuthSystem.canAdmin());
    const status = document.getElementById("chat-status");
    if (status) status.textContent = this.access.can_send ? "Community channels · Be respectful." : "You are currently in read-only mode. You can still follow the conversation.";
    const input = document.getElementById("chat-input");
    if (input) input.disabled = !this.access.can_send;
    const send = document.getElementById("chat-send");
    if (send) send.disabled = !this.access.can_send;
    const readonly = document.getElementById("chat-readonly");
    if (readonly) { readonly.hidden = this.access.can_send; readonly.textContent = (this.access.reason || "Chat is read-only for this account.") + (this.access.expires_at ? " · Until " + new Date(this.access.expires_at).toLocaleString() : ""); }
  },
  showAppealOnly() {
    this.setVisible("chat-signin", false); this.setVisible("chat-workspace", false);
    this.setVisible("chat-appeal", true); this.setVisible("chat-moderation", false); this.setVisible("chat-review", false);
    const status = document.getElementById("chat-status");
    if (status) status.textContent = "Chat access is restricted.";
    const detail = document.getElementById("chat-appeal-detail");
    if (detail) detail.textContent = (this.access.reason || "Your chat access is currently restricted.") + (this.access.expires_at ? " Until " + new Date(this.access.expires_at).toLocaleString() + "." : "");
    const submit = document.getElementById("chat-appeal-submit");
    if (submit) submit.disabled = !!this.access.appeal_pending;
    const state = document.getElementById("chat-appeal-state");
    if (state) state.textContent = this.access.appeal_pending ? "You already have an appeal awaiting review." : "You may submit an appeal for review by the development team.";
  },
  setVisible(id, visible) { const el = document.getElementById(id); if (el) el.hidden = !visible; },

  async loadChannels() {
    const { data, error } = await AuthSystem.client.from("chat_channels").select("id,slug,name,description,sort_order").order("sort_order");
    if (error) throw error;
    this.channelRows = data || [];
    const list = document.getElementById("chat-channel-list");
    if (!list) return;
    list.replaceChildren();
    this.channelRows.forEach(channel => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "chat-channel";
      button.textContent = "# " + channel.name;
      button.addEventListener("click", () => this.selectChannel(channel));
      list.appendChild(button);
    });
    if (this.channelRows.length) await this.selectChannel(this.channelRows[0]);
  },

  async selectChannel(channel) {
    this.currentChannel = channel;
    document.querySelectorAll(".chat-channel").forEach((el, i) => el.classList.toggle("active", this.channelRows[i] && this.channelRows[i].id === channel.id));
    const title = document.getElementById("chat-channel-title");
    const desc = document.getElementById("chat-channel-description");
    if (title) title.textContent = "# " + channel.name;
    if (desc) desc.textContent = channel.description || "";
    await this.loadMessages();
    this.subscribeMessages();
  },

  async loadMessages() {
    if (!this.currentChannel) return;
    const list = document.getElementById("chat-messages");
    if (!list) return;
    list.textContent = "Loading messages...";
    const { data, error } = await AuthSystem.client.from("chat_messages")
      .select("id,channel_id,user_id,username,body,reply_to,created_at,updated_at")
      .eq("channel_id", this.currentChannel.id).order("created_at", { ascending: false }).limit(60);
    if (error) throw error;
    const messages = (data || []).reverse();
    if (messages.length) {
      const ids = messages.map(message => message.id);
      const { data: reactions, error: reactionError } = await AuthSystem.client.from("chat_reactions").select("message_id,user_id,emoji").in("message_id", ids);
      if (!reactionError) {
        const counts = {};
        (reactions || []).forEach(r => { const key = r.message_id + "|" + r.emoji; counts[key] = (counts[key] || 0) + 1; });
        messages.forEach(message => { message.reaction_counts = counts; });
      }
    }
    list.replaceChildren();
    if (!messages.length) { const empty = document.createElement("p"); empty.className = "chat-empty"; empty.textContent = "No messages here yet. Start the conversation."; list.appendChild(empty); }
    messages.forEach(message => this.renderMessage(message, false));
    list.scrollTop = list.scrollHeight;
  },

  subscribeMessages() {
    if (this.subscription) AuthSystem.client.removeChannel(this.subscription);
    if (!this.currentChannel) return;
    this.subscription = AuthSystem.client.channel("chat-messages-" + this.currentChannel.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: "channel_id=eq." + this.currentChannel.id }, payload => {
        this.renderMessage(payload.new, true);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages", filter: "channel_id=eq." + this.currentChannel.id }, payload => {
        this.replaceMessage(payload.new);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_reactions" }, () => this.loadMessages())
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_reactions" }, () => this.loadMessages())
      .subscribe();
  },

  renderMessage(message, scroll) {
    const list = document.getElementById("chat-messages");
    if (!list || document.getElementById("chat-message-" + message.id)) return;
    if (list.textContent === "Loading messages..." || list.querySelector(".chat-empty")) list.replaceChildren();
    const article = document.createElement("article");
    article.className = "chat-message"; article.id = "chat-message-" + message.id;
    const head = document.createElement("div"); head.className = "chat-message-head";
    const author = document.createElement("strong"); author.textContent = message.username || "Unknown wanderer";
    const time = document.createElement("time"); time.dateTime = message.created_at; time.textContent = new Date(message.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
    head.append(author, time);
    const body = document.createElement("p"); body.className = "chat-message-body";
    const mentionPattern = /(@[A-Za-z0-9_]{3,20})/g; let cursor = 0; let match;
    while ((match = mentionPattern.exec(message.body)) !== null) {
      if (match.index > cursor) body.appendChild(document.createTextNode(message.body.slice(cursor, match.index)));
      const mention = document.createElement("span"); mention.className = "chat-mention"; mention.textContent = match[0]; body.appendChild(mention); cursor = match.index + match[0].length;
    }
    if (cursor < message.body.length) body.appendChild(document.createTextNode(message.body.slice(cursor)));
    article.append(head, body);
    if (message.reply_to) {
      const reply = document.createElement("small"); reply.className = "chat-reply-label"; reply.textContent = "↳ Reply"; article.insertBefore(reply, head);
    }
    const actions = document.createElement("div"); actions.className = "chat-message-actions";
    if (this.access.can_send) actions.appendChild(this.actionButton("Reply", () => this.setReply(message)));
    if (message.user_id === AuthSystem.user.id && this.access.can_send) {
      actions.appendChild(this.actionButton("Edit", () => this.editMessage(message)));
      actions.appendChild(this.actionButton("Delete", () => this.deleteMessage(message.id, false)));
    }
    if (AuthSystem.canModerate()) actions.appendChild(this.actionButton("Remove", () => this.deleteMessage(message.id, true)));
    if (this.access.can_send) this.reactions.forEach(emoji => {
      const count = message.reaction_counts ? (message.reaction_counts[message.id + "|" + emoji] || 0) : 0;
      const button = this.actionButton(emoji + (count ? " " + count : ""), () => this.toggleReaction(message.id, emoji), "chat-reaction");
      actions.appendChild(button);
    });
    article.appendChild(actions); list.appendChild(article);
    if (scroll) {
      list.scrollTop = list.scrollHeight;
      const ownName = AuthSystem.username();
      if (message.user_id !== AuthSystem.user.id && new RegExp("@" + ownName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(message.body)) this.showMentionNotice(message.username);
    }
  },
  replaceMessage(message) {
    const old = document.getElementById("chat-message-" + message.id);
    if (old) old.remove();
    this.renderMessage(message, false);
  },
  showMentionNotice(sender) {
    const notice = document.getElementById("chat-mention-notice");
    if (!notice) return;
    notice.textContent = "You were mentioned by " + sender + " in #" + (this.currentChannel ? this.currentChannel.name : "chat") + ".";
    notice.hidden = false;
    clearTimeout(this._mentionTimer);
    this._mentionTimer = setTimeout(() => { notice.hidden = true; }, 6500);
  },
  actionButton(label, callback, className) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = label;
    button.className = className || "chat-action"; button.addEventListener("click", callback); return button;
  },
  setReply(message) {
    this.replyTo = message.id;
    const box = document.getElementById("chat-replying");
    if (box) { box.hidden = false; const label = document.getElementById("chat-replying-text"); if (label) label.textContent = "Replying to " + message.username + ": " + message.body.slice(0, 90); }
    const input = document.getElementById("chat-input"); if (input) input.focus();
  },
  clearReply() { this.replyTo = null; const box = document.getElementById("chat-replying"); if (box) box.hidden = true; },
  async sendMessage() {
    if (!this.access || !this.access.can_send || !this.currentChannel) return;
    const input = document.getElementById("chat-input"); const status = document.getElementById("chat-compose-status");
    const body = input ? input.value.trim() : "";
    if (!body) return;
    if (body.length > 1200) { if (status) status.textContent = "Messages are limited to 1,200 characters."; return; }
    const payload = { channel_id: this.currentChannel.id, user_id: AuthSystem.user.id, body, reply_to: this.replyTo };
    if (input) input.disabled = true;
    try {
      const { error } = await AuthSystem.client.from("chat_messages").insert(payload);
      if (error) throw error;
      if (input) input.value = ""; if (status) status.textContent = ""; this.clearReply();
    } catch (error) { if (status) status.textContent = error.message || "Message could not be sent."; }
    finally { if (input) input.disabled = !this.access.can_send; }
  },
  async editMessage(message) {
    const body = window.prompt("Edit your message:", message.body);
    if (body === null || !body.trim()) return;
    const { error } = await AuthSystem.client.from("chat_messages").update({ body: body.trim() }).eq("id", message.id).eq("user_id", AuthSystem.user.id);
    if (error) window.alert(error.message);
  },
  async deleteMessage(id, staff) {
    if (!window.confirm(staff ? "Remove this message for everyone?" : "Delete your message?")) return;
    const { error } = await AuthSystem.client.rpc("chat_delete_message", { p_message_id: id });
    if (error) window.alert(error.message);
  },
  async toggleReaction(messageId, emoji) {
    const { error } = await AuthSystem.client.rpc("chat_toggle_reaction", { p_message_id: messageId, p_emoji: emoji });
    if (error) { const status = document.getElementById("chat-compose-status"); if (status) status.textContent = error.message; }
    else await this.loadMessages();
  },

  async startPresence() {
    if (this.presenceChannel) AuthSystem.client.removeChannel(this.presenceChannel);
    this.presenceChannel = AuthSystem.client.channel("chat-presence", { config: { presence: { key: AuthSystem.user.id } } });
    this.presenceChannel.on("presence", { event: "sync" }, () => this.renderPresence());
    await this.presenceChannel.subscribe(async state => {
      if (state === "SUBSCRIBED") {
        await this.presenceChannel.track({ user_id: AuthSystem.user.id, username: AuthSystem.username(), role: AuthSystem.roleLabel(AuthSystem.role()) });
      }
    });
  },
  renderPresence() {
    if (!this.presenceChannel) return;
    const box = document.getElementById("chat-online-list"); if (!box) return;
    const state = this.presenceChannel.presenceState(); box.replaceChildren();
    const users = [];
    Object.values(state).forEach(entries => entries.forEach(entry => { if (entry.username && !users.some(u => u.user_id === entry.user_id)) users.push(entry); }));
    users.sort((a,b) => a.username.localeCompare(b.username));
    users.forEach(user => { const item = document.createElement("div"); item.className = "chat-online-user"; const dot = document.createElement("i"); const name = document.createElement("span"); name.textContent = user.username; item.append(dot,name); box.appendChild(item); });
    const count = document.getElementById("chat-online-count"); if (count) count.textContent = String(users.length);
    this.onlineUserIds = new Set(users.map(user => user.user_id));
    // Presence is display-only. Moderation targets are loaded from registered accounts.
    const target = document.getElementById("chat-mod-target");
    if (target) Array.from(target.options).forEach(option => {
      if (!option.value || !option.dataset.username) return;
      const online = this.onlineUserIds.has(option.value);
      option.textContent = "@" + option.dataset.username + (online ? " · online" : " · offline");
    });
  },

  async searchModerationTargets() {
    const input = document.getElementById("chat-mod-search");
    const select = document.getElementById("chat-mod-target");
    const status = document.getElementById("chat-mod-status");
    if (!input || !select) return;
    const query = input.value.trim();
    const token = ++this.targetSearchToken;
    select.replaceChildren();
    const placeholder = document.createElement("option"); placeholder.value = "";
    placeholder.textContent = query.length < 2 ? "Type at least 2 characters" : "Searching accounts…";
    select.appendChild(placeholder);
    if (query.length < 2) return;
    const { data, error } = await AuthSystem.client.rpc("chat_search_moderation_targets", { p_query: query });
    if (token !== this.targetSearchToken) return;
    select.replaceChildren();
    if (error) {
      const option = document.createElement("option"); option.value = ""; option.textContent = "Account search unavailable"; select.appendChild(option);
      if (status) status.textContent = error.message;
      return;
    }
    const empty = document.createElement("option"); empty.value = ""; empty.textContent = data && data.length ? "Select account" : "No matching accounts"; select.appendChild(empty);
    (data || []).forEach(account => {
      const option = document.createElement("option"); option.value = account.user_id;
      option.dataset.username = account.username;
      const online = this.onlineUserIds.has(account.user_id);
      const role = account.owner ? "Owner" : account.role;
      option.textContent = "@" + account.username + " · " + (online ? "online" : "offline") + " · " + role;
      select.appendChild(option);
    });
  },

  async moderateUser() {
    const target = document.getElementById("chat-mod-target").value;
    const action = document.getElementById("chat-mod-action").value;
    const reason = document.getElementById("chat-mod-reason").value.trim();
    const duration = Number(document.getElementById("chat-mod-duration").value || 0);
    const status = document.getElementById("chat-mod-status");
    if (!target || !reason) { if (status) status.textContent = "Search for an account, select it, and provide a reason."; return; }
    const selected = document.getElementById("chat-mod-target").selectedOptions[0];
    const username = selected && selected.dataset.username ? selected.dataset.username : "the selected account";
    const { error } = await AuthSystem.client.rpc("chat_moderate_user", { p_target_user_id: target, p_action: action, p_reason: reason, p_duration_minutes: duration });
    if (status) status.textContent = error ? error.message : "Action recorded for @" + username + ". It applies whether the account is online or offline.";
    if (!error) { document.getElementById("chat-mod-reason").value = ""; }
  },
  async loadReviewQueue() {
    const list = document.getElementById("chat-review-list"); if (!list || !AuthSystem.canAdmin()) return;
    const { data, error } = await AuthSystem.client.rpc("chat_list_moderation_queue");
    list.replaceChildren();
    if (error) { list.textContent = error.message; return; }
    (data || []).forEach(item => {
      const row = document.createElement("div"); row.className = "chat-review-item";
      const text = document.createElement("p"); text.textContent = item.queue_type + " · " + item.target_username + " · " + item.reason;
      row.appendChild(text);
      if (item.queue_type === "ban_request" || item.queue_type === "appeal") {
        const approve = this.actionButton(item.queue_type === "appeal" ? "Approve appeal" : "Approve ban", () => this.reviewItem(item, true));
        const reject = this.actionButton("Reject", () => this.reviewItem(item, false)); row.append(approve, reject);
      }
      list.appendChild(row);
    });
    if (!data || !data.length) list.textContent = "No pending reviews.";
  },
  async reviewItem(item, approve) {
    const fn = item.queue_type === "appeal" ? "chat_review_appeal" : "chat_review_ban_request";
    const args = item.queue_type === "appeal" ? { p_appeal_id: item.id, p_approve: approve, p_decision: approve ? "Appeal approved." : "Appeal rejected." } : { p_action_id: item.id, p_approve: approve };
    const { error } = await AuthSystem.client.rpc(fn, args);
    if (error) window.alert(error.message); else await this.loadReviewQueue();
  },
  async submitAppeal() {
    const reason = document.getElementById("chat-appeal-reason").value.trim();
    const state = document.getElementById("chat-appeal-state");
    if (reason.length < 20) { if (state) state.textContent = "Please provide at least 20 characters so the team can review your appeal."; return; }
    const { error } = await AuthSystem.client.rpc("chat_submit_appeal", { p_reason: reason });
    if (state) state.textContent = error ? error.message : "Appeal submitted for review.";
    if (!error) { const button = document.getElementById("chat-appeal-submit"); if (button) button.disabled = true; }
  },
  teardownSubscriptions() {
    if (this.subscription && AuthSystem.client) AuthSystem.client.removeChannel(this.subscription);
    if (this.presenceChannel && AuthSystem.client) AuthSystem.client.removeChannel(this.presenceChannel);
    this.subscription = null; this.presenceChannel = null;
  }
};

window.addEventListener("beforeunload", () => ChatSystem.teardownSubscriptions());
