/* Backrooms Runner — community chat MVP. Requires AuthSystem and Supabase JS v2. */
"use strict";

const ChatSystem = {
  channelRows: [], currentChannel: null, subscription: null, presenceChannel: null,
  presenceTimer: null, replyTo: null, access: null, initialized: false,
  targetSearchToken: 0, onlineUserIds: new Set(), myAppeals: [], editingAppealId: null, creatingAppeal: false,
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
    const appealCancel = document.getElementById("chat-appeal-cancel");
    if (appealCancel) appealCancel.addEventListener("click", () => this.cancelAppealEdit());
    const appealNew = document.getElementById("chat-appeal-new");
    if (appealNew) appealNew.addEventListener("click", () => this.openNewAppeal());
    const mod = document.getElementById("chat-mod-submit");
    if (mod) mod.addEventListener("click", () => this.moderateUser());
    const historyLoad = document.getElementById("chat-mod-history-load");
    if (historyLoad) historyLoad.addEventListener("click", () => this.loadTargetAutomodHistory());
    const targetSearch = document.getElementById("chat-mod-search");
    if (targetSearch) targetSearch.addEventListener("input", () => this.searchModerationTargets());
    const review = document.getElementById("chat-review-refresh");
    if (review) review.addEventListener("click", () => this.loadReviewQueue());
    const configSave = document.getElementById("chat-automod-save");
    if (configSave) configSave.addEventListener("click", () => this.saveAutomodConfig());
    const configReload = document.getElementById("chat-automod-config-refresh");
    if (configReload) configReload.addEventListener("click", () => this.loadAutomodConfig());
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
    this.setVisible("chat-automod-config", false);
    this.teardownSubscriptions();
    try {
      this.access = await this.getAccess();
      this.myAppeals = await this.loadMyAppeals();
      const latestAppeal = this.myAppeals[0];
      if (!this.access.can_read || (latestAppeal && latestAppeal.status === "approved" && !latestAppeal.acknowledged_at)) {
        this.showAppealOnly(); return;
      }
      this.showChat();
      await this.loadAutomodStatus();
      if (AuthSystem.canAdmin()) { await this.loadAutomodConfig(); await this.loadAutomodStats(); }
      await this.loadChannels();
      await this.startPresence();
      if (AuthSystem.canModerate()) {
        const panel = document.getElementById("chat-moderation");
        if (panel) panel.hidden = false;
      }
      if (AuthSystem.canAdmin()) {
        const queue = document.getElementById("chat-review");
        const config = document.getElementById("chat-automod-config");
        if (queue) queue.hidden = false;
        if (config) config.hidden = false;
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
    this.setVisible("chat-automod-config", false); this.setVisible("chat-automod-status", false);
    const status = document.getElementById("chat-status");
    if (status) status.textContent = "Sign in to join the Backrooms Runner community.";
  },
  showChat() {
    this.setVisible("chat-signin", false); this.setVisible("chat-workspace", true);
    this.setVisible("chat-appeal", false); this.setVisible("chat-automod-status", true);
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
    this.setVisible("chat-automod-config", false); this.setVisible("chat-automod-status", true);
    const status = document.getElementById("chat-status");
    if (status) status.textContent = "Chat access is restricted.";
    const detail = document.getElementById("chat-appeal-detail");
    const latest = (this.myAppeals || [])[0];
    if (detail) detail.textContent = latest && latest.status === "approved" && this.access.can_read
      ? "Your appeal was approved. Your chat restriction has been lifted. Select Return to Chat when you're ready."
      : (this.access.reason || "Your chat access is currently restricted.") + (this.access.expires_at ? " Until " + new Date(this.access.expires_at).toLocaleString() + "." : "");
    this.renderAppeals();
  },
  async loadMyAppeals() {
    const { data, error } = await AuthSystem.client.rpc("chat_get_my_appeals");
    if (error) throw error;
    return data || [];
  },
  renderAppeals() {
    const list = this.myAppeals || [];
    const latest = list[0] || null;
    const activeRestriction = !!(this.access && this.access.can_read === false);
    const pending = list.find(item => item.status === "pending") || null;
    const card = document.getElementById("chat-appeal-case");
    const form = document.getElementById("chat-appeal-form");
    const history = document.getElementById("chat-appeal-history");
    const heading = document.getElementById("chat-appeal-heading");
    const state = document.getElementById("chat-appeal-state");
    const newButton = document.getElementById("chat-appeal-new");
    if (heading) heading.textContent = latest && latest.status === "approved" && !activeRestriction ? "APPEAL APPROVED" : "CHAT ACCESS RESTRICTED";
    if (card) {
      card.replaceChildren(); card.hidden = !latest;
      if (latest) {
        const head = document.createElement("div"); head.className = "chat-appeal-case-head";
        const token = document.createElement("strong"); token.className = "chat-appeal-token"; token.textContent = "APPEAL TOKEN · " + String(latest.id).slice(0, 8).toUpperCase();
        const badge = document.createElement("span"); badge.className = "chat-appeal-status " + (latest.status === "pending" ? "waiting" : latest.status); badge.textContent = latest.status.toUpperCase() === "PENDING" ? "WAITING" : latest.status.toUpperCase();
        head.append(token, badge); card.appendChild(head);
        const username = document.createElement("p"); username.className = "chat-appeal-username"; username.textContent = "Username: " + (latest.username || "Your account"); card.appendChild(username);
        const reason = document.createElement("p"); reason.className = "chat-appeal-reason-view"; reason.textContent = latest.reason; card.appendChild(reason);
        const submitted = document.createElement("p"); submitted.className = "chat-appeal-decision"; submitted.textContent = "Submitted " + new Date(latest.created_at).toLocaleString(); card.appendChild(submitted);
        if (latest.decision) { const decision = document.createElement("p"); decision.className = "chat-appeal-decision"; decision.textContent = "Staff decision: " + latest.decision; card.appendChild(decision); }
        if (latest.status === "pending") {
          const edit = this.actionButton("Edit reasoning", () => this.beginAppealEdit(latest)); card.appendChild(edit);
        } else if (latest.status === "approved" && !activeRestriction) {
          const back = document.createElement("button"); back.type = "button"; back.className = "chat-primary"; back.textContent = "RETURN TO CHAT"; back.addEventListener("click", () => this.returnToChat(latest.id)); card.appendChild(back);
        }
      }
    }
    if (history) {
      history.replaceChildren(); const older = list.slice(1); history.hidden = !older.length;
      if (older.length) { const h = document.createElement("h4"); h.textContent = "PREVIOUS APPEALS"; history.appendChild(h); older.forEach(item => { const row = document.createElement("div"); row.className = "chat-appeal-history-item"; row.textContent = "#" + String(item.id).slice(0,8).toUpperCase() + " · " + item.status.toUpperCase() + " · " + new Date(item.created_at).toLocaleDateString(); history.appendChild(row); }); }
    }
    const canStartNew = activeRestriction && !pending;
    if (newButton) newButton.hidden = !canStartNew || !!this.editingAppealId;
    if (form) form.hidden = !this.editingAppealId && !this.creatingAppeal;
    const submit = document.getElementById("chat-appeal-submit");
    if (submit) submit.textContent = this.editingAppealId ? "SAVE CHANGES" : "SUBMIT APPEAL";
    const cancel = document.getElementById("chat-appeal-cancel"); if (cancel) cancel.hidden = !this.editingAppealId && !this.creatingAppeal;
    if (state) state.textContent = pending ? "Your appeal is waiting for review. You can edit its reasoning, but cannot open another application yet." : latest && latest.status === "rejected" && activeRestriction ? "Your appeal was rejected. You may submit a new application for this active restriction; previous applications remain in your history." : latest && latest.status === "approved" && activeRestriction ? "Your previous appeal was approved, but this account has since received a new chat restriction. You may submit a new application." : latest && latest.status === "approved" ? "Your appeal was approved and your chat restriction has been lifted." : "You may submit an appeal for this chat restriction.";
  },
  beginAppealEdit(appeal) {
    this.editingAppealId = appeal.id;
    this.creatingAppeal = false;
    const newButton = document.getElementById("chat-appeal-new"); if (newButton) newButton.hidden = true;
    const input = document.getElementById("chat-appeal-reason"); if (input) input.value = appeal.reason;
    const form = document.getElementById("chat-appeal-form"); if (form) form.hidden = false;
    const submit = document.getElementById("chat-appeal-submit"); if (submit) submit.textContent = "SAVE CHANGES";
    const cancel = document.getElementById("chat-appeal-cancel"); if (cancel) cancel.hidden = false;
  },
  openNewAppeal() {
    if ((this.myAppeals || []).some(item => item.status === "pending")) return;
    if (!this.access || this.access.can_read !== false) return;
    this.editingAppealId = null;
    this.creatingAppeal = true;
    const newButton = document.getElementById("chat-appeal-new"); if (newButton) newButton.hidden = true;
    const input = document.getElementById("chat-appeal-reason"); if (input) input.value = "";
    const form = document.getElementById("chat-appeal-form"); if (form) form.hidden = false;
    const submit = document.getElementById("chat-appeal-submit"); if (submit) submit.textContent = "SUBMIT APPEAL";
    const cancel = document.getElementById("chat-appeal-cancel"); if (cancel) cancel.hidden = false;
  },
  cancelAppealEdit() {
    this.editingAppealId = null;
    this.creatingAppeal = false;
    const input = document.getElementById("chat-appeal-reason"); if (input) input.value = "";
    this.renderAppeals();
  },
  async submitAppeal() {
    const input = document.getElementById("chat-appeal-reason");
    const reason = input ? input.value.trim() : "";
    const state = document.getElementById("chat-appeal-state");
    if (reason.length < 20) { if (state) state.textContent = "Please provide at least 20 characters so the team can review your appeal."; return; }
    const editingId = this.editingAppealId;
    const fn = editingId ? "chat_edit_appeal" : "chat_submit_appeal";
    const args = editingId ? { p_appeal_id: editingId, p_reason: reason } : { p_reason: reason };
    const { error } = await AuthSystem.client.rpc(fn, args);
    if (error) { if (state) state.textContent = error.message; return; }
    this.editingAppealId = null;
    this.creatingAppeal = false;
    if (input) input.value = "";
    this.myAppeals = await this.loadMyAppeals();
    this.renderAppeals();
  },
  async returnToChat(appealId) {
    const { error } = await AuthSystem.client.rpc("chat_acknowledge_appeal", { p_appeal_id: appealId });
    if (error) { const state = document.getElementById("chat-appeal-state"); if (state) state.textContent = error.message; return; }
    this.myAppeals = await this.loadMyAppeals();
    this.access = await this.getAccess();
    if (!this.access.can_read) { this.showAppealOnly(); return; }
    this.showChat();
    await this.loadChannels();
    await this.startPresence();
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
    if (message.user_id !== AuthSystem.user.id) actions.appendChild(this.actionButton("Report", () => this.reportMessage(message)));
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
    if (input) input.disabled = true;
    try {
      const { data, error } = await AuthSystem.client.rpc("chat_send_message", {
        p_channel_id: this.currentChannel.id, p_body: body, p_reply_to: this.replyTo
      });
      if (error) throw error;
      if (data && data.sent === false && data.staff_review) {
        if (status) status.textContent = data.reason || "This message was blocked and sent for Developer/Owner review.";
        if (input) input.value = "";
        await this.loadReviewQueue();
        return;
      }
      if (data && data.sent === false && data.automod) {
        if (status) {
          const strike = data.penalty && data.penalty.strike_number;
          const response = strike === 1 ? "Informal reminder issued; another violation may result in a formal warning." : "Formal warning recorded.";
          const duration = data.penalty && data.penalty.applied_minutes;
          status.textContent = "AutoMod: " + data.reason + " · " + response + (duration ? " · Restriction: " + (duration >= 60 ? (duration / 60) + " hour(s)" : duration + " minute(s)") : "");
        }
        if (input) input.value = "";
        await this.loadAutomodStatus();
        this.access = await this.getAccess();
        if (!this.access.can_read) {
          this.myAppeals = await this.loadMyAppeals();
          this.showAppealOnly();
        } else {
          this.showChat();
        }
        return;
      }
      if (input) input.value = "";
      if (status) status.textContent = data && data.notice ? data.notice : "";
      this.clearReply();
      if (data && data.staff_review) await this.loadReviewQueue();
    } catch (error) { if (status) status.textContent = error.message || "Message could not be sent."; }
    finally { if (input) input.disabled = !this.access.can_send; }
  },
  async reportMessage(message) {
    const category = window.prompt("Report category: harassment, hate_speech, spam, links, evasion, or other", "harassment");
    if (!category) return;
    const normalized = category.trim().toLowerCase();
    if (!["harassment", "hate_speech", "spam", "links", "evasion", "other"].includes(normalized)) {
      window.alert("Please enter one of the listed report categories."); return;
    }
    const reason = window.prompt("Briefly explain what concerns you (at least 8 characters):", "");
    if (!reason) return;
    const { error } = await AuthSystem.client.rpc("chat_report_message", {
      p_message_id: message.id, p_category: normalized, p_reason: reason.trim()
    });
    if (error) window.alert(error.message); else window.alert("Report submitted for staff review. A report does not automatically punish the other account.");
  },
  async editMessage(message) {
    const body = window.prompt("Edit your message:", message.body);
    if (body === null || !body.trim()) return;
    const { error } = await AuthSystem.client.rpc("chat_edit_message", { p_message_id: message.id, p_body: body.trim() });
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

  async loadTargetAutomodHistory() {
    const target = document.getElementById("chat-mod-target").value;
    const box = document.getElementById("chat-mod-automod-history");
    if (!target || !box) { if (box) box.textContent = "Select an account first."; return; }
    const { data, error } = await AuthSystem.client.rpc("chat_list_target_automod_history", { p_target_user_id: target });
    box.replaceChildren();
    if (error) { box.textContent = error.message; return; }
    (data || []).forEach(item => {
      const row = document.createElement("div"); row.className = "chat-review-item";
      const detail = document.createElement("p");
      detail.textContent = item.category + " · " + item.reason + " · " + new Date(item.created_at).toLocaleString() + " · " + item.outcome + (item.strike_number ? " · Strike " + item.strike_number : "");
      row.appendChild(detail);
      if (item.outcome === "applied") row.appendChild(this.actionButton("Reverse", async () => {
        const reason = window.prompt("Why is this AutoMod action being reversed? (at least 8 characters)", "False positive");
        if (!reason) return;
        const { error: reverseError } = await AuthSystem.client.rpc("chat_reverse_automod_event", { p_event_id: item.id, p_reason: reason });
        if (reverseError) window.alert(reverseError.message); else await this.loadTargetAutomodHistory();
      }));
      box.appendChild(row);
    });
    if (!data || !data.length) box.textContent = "No AutoMod history for this account.";
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
    list.replaceChildren();
    const { data: moderation, error: moderationError } = await AuthSystem.client.rpc("chat_list_moderation_queue");
    const { data: automod, error: automodError } = await AuthSystem.client.rpc("chat_list_automod_review_queue");
    if (moderationError && automodError) { list.textContent = moderationError.message; return; }
    (automod || []).forEach(item => {
      const callerRank = AuthSystem.isOwner() ? 4 : (AuthSystem.role() === "developer" ? 3 : 0);
      const targetRank = item.target_owner ? 4 : (item.target_role === "developer" ? 3 : item.target_role === "moderator" ? 2 : item.target_role === "tester" ? 1 : 0);
      const canReview = targetRank < callerRank || (AuthSystem.isOwner() && item.target_owner && item.target_user_id !== AuthSystem.user.id);
      const row = document.createElement("div"); row.className = "chat-review-item";
      const text = document.createElement("p");
      text.textContent = "AUTOMOD · " + item.target_username + " · " + item.category + " · " + item.reason + " · Suggested: " + item.suggested_action;
      row.appendChild(text);
      if (canReview) {
        const approve = this.actionButton("Approve punishment", () => this.reviewAutomodItem(item, "approve"));
        const dismiss = this.actionButton("Dismiss", () => this.reviewAutomodItem(item, "dismiss"));
        row.append(approve, dismiss);
      } else {
        const note = document.createElement("small"); note.textContent = "Requires review by a higher-ranked staff member."; row.appendChild(note);
      }
      list.appendChild(row);
    });
    (moderation || []).forEach(item => {
      const row = document.createElement("div"); row.className = "chat-review-item";
      const text = document.createElement("p"); text.textContent = item.queue_type + " · " + item.target_username + " · " + item.reason;
      row.appendChild(text);
      if (item.queue_type === "ban_request" || item.queue_type === "appeal") {
        const approve = this.actionButton(item.queue_type === "appeal" ? "Approve appeal" : "Approve ban", () => this.reviewItem(item, true));
        const reject = this.actionButton("Reject", () => this.reviewItem(item, false)); row.append(approve, reject);
      }
      list.appendChild(row);
    });
    if (!list.children.length) list.textContent = "No pending reviews.";
  },
  async reviewAutomodItem(item, decision) {
    const note = window.prompt("Optional review note:", "") || "";
    const { error } = await AuthSystem.client.rpc("chat_review_automod_case", {
      p_case_id: item.id, p_decision: decision, p_note: note
    });
    if (error) window.alert(error.message); else { await this.loadReviewQueue(); await this.loadAutomodStats(); }
  },
  async reviewItem(item, approve) {
    const fn = item.queue_type === "appeal" ? "chat_review_appeal" : "chat_review_ban_request";
    const args = item.queue_type === "appeal" ? { p_appeal_id: item.id, p_approve: approve, p_decision: approve ? "Appeal approved." : "Appeal rejected." } : { p_action_id: item.id, p_approve: approve };
    const { error } = await AuthSystem.client.rpc(fn, args);
    if (error) window.alert(error.message); else await this.loadReviewQueue();
  },
  async loadAutomodStatus() {
    const box = document.getElementById("chat-automod-status"); if (!box) return;
    const { data, error } = await AuthSystem.client.rpc("chat_get_my_automod_status");
    box.replaceChildren();
    if (error) { box.textContent = "Moderation status unavailable: " + error.message; return; }
    const heading = document.createElement("h3"); heading.textContent = "MY MODERATION STATUS"; box.appendChild(heading);
    const summary = document.createElement("p"); summary.textContent = "Active formal warnings: " + data.formal_warnings + " · Next formal warning: " + data.next_warning_action; box.appendChild(summary);
    const strikeLine = document.createElement("p");
    const strikes = (data.strikes || []).map(x => x.category + ": " + x.count).join(" · ") || "No active strikes";
    strikeLine.textContent = "Active AutoMod strikes: " + strikes; box.appendChild(strikeLine);
    (data.next_strike_actions || []).forEach(item => {
      const next = document.createElement("p");
      next.textContent = "Next " + item.category + " strike (" + (item.count + 1) + "): " + item.next_action;
      box.appendChild(next);
    });
    const activeMute = data.muted_until && new Date(data.muted_until) > new Date();
    const activeSuspension = data.suspended_until && new Date(data.suspended_until) > new Date();
    if (activeMute || activeSuspension || data.permanent) {
      const restriction = document.createElement("p");
      restriction.textContent = data.permanent ? "Current restriction: permanent chat suspension" : "Current restriction until " + new Date(activeSuspension ? data.suspended_until : data.muted_until).toLocaleString();
      if (data.restriction_reason) restriction.textContent += " · Reason: " + data.restriction_reason;
      box.appendChild(restriction);
    }
    const history = document.createElement("details"); const summaryEl = document.createElement("summary"); summaryEl.textContent = "Moderation history"; history.appendChild(summaryEl);
    (data.recent || []).forEach(item => {
      const line = document.createElement("p"); line.className = "chat-automod-history-row";
      line.textContent = item.category + " · " + item.reason + " · " + new Date(item.created_at).toLocaleDateString() + " · " + (new Date(item.expires_at) > new Date() ? "Active" : "Expired") + " · " + item.outcome;
      history.appendChild(line);
    });
    box.appendChild(history);
    const warningHistory = document.createElement("details");
    const warningSummary = document.createElement("summary"); warningSummary.textContent = "Formal warning history"; warningHistory.appendChild(warningSummary);
    (data.warning_history || []).forEach(item => {
      const line = document.createElement("p"); line.className = "chat-automod-history-row";
      const state = item.reversed_at ? "Reversed" : (item.active ? "Active" : "Expired");
      line.textContent = item.category + " · " + item.reason + " · Issued " + new Date(item.created_at).toLocaleDateString() + " · " + state + " · Expires " + new Date(item.expires_at).toLocaleDateString();
      warningHistory.appendChild(line);
    });
    box.appendChild(warningHistory);
  },
  async loadAutomodConfig() {
    const panel = document.getElementById("chat-automod-config"); if (!panel || !AuthSystem.canAdmin()) return;
    const { data, error } = await AuthSystem.client.rpc("chat_admin_get_automod_config");
    const status = document.getElementById("chat-automod-config-status");
    if (error) { if (status) status.textContent = error.message; return; }
    const fields = { enabled: "chat-automod-enabled", enforcement_enabled: "chat-automod-enforcement", spam_messages_10s: "chat-automod-spam10", spam_messages_60s: "chat-automod-spam60", new_spam_messages_10s: "chat-automod-newspam10", new_spam_messages_60s: "chat-automod-newspam60", mention_distinct_limit: "chat-automod-mentions", new_mention_distinct_limit: "chat-automod-newmentions", links_30s: "chat-automod-links", new_links_30s: "chat-automod-newlinks", links_10m: "chat-automod-links10m", new_links_10m: "chat-automod-newlinks10m" };
    Object.entries(fields).forEach(([key,id]) => { const el=document.getElementById(id); if(el) { if(el.type === "checkbox") el.checked=!!data[key]; else el.value=data[key]; } });
    if (status) status.textContent = "Configuration loaded.";
  },
  async loadAutomodStats() {
    const box = document.getElementById("chat-automod-stats"); if (!box || !AuthSystem.canAdmin()) return;
    const { data, error } = await AuthSystem.client.rpc("chat_admin_get_automod_stats");
    box.replaceChildren();
    if (error) { box.textContent = error.message; return; }
    const items = [
      ["Pending staff reviews", data.pending_review], ["Detections · 24h", data.detections_24h],
      ["Applied · 7d", data.applied_7d], ["Overturned · 7d", data.overturned_7d],
      ["Dismissed · 7d", data.dismissed_7d], ["User reports · 7d", data.reports_7d]
    ];
    items.forEach(([label,value]) => { const card=document.createElement("div"); card.className="chat-automod-stat"; const strong=document.createElement("strong"); strong.textContent=String(value); const small=document.createElement("span"); small.textContent=label; card.append(strong,small); box.appendChild(card); });
    const audit = document.createElement("details");
    const auditTitle = document.createElement("summary"); auditTitle.textContent = "Recent configuration audit"; audit.appendChild(auditTitle);
    (data.config_changes || []).forEach(change => {
      const line = document.createElement("p"); line.className = "chat-automod-history-row";
      line.textContent = change.actor + " · " + new Date(change.created_at).toLocaleString() + " · Thresholds/configuration updated";
      audit.appendChild(line);
    });
    if (!(data.config_changes || []).length) { const empty=document.createElement("p"); empty.textContent="No configuration changes recorded yet."; audit.appendChild(empty); }
    box.appendChild(audit);
  },
  async saveAutomodConfig() {
    const get = id => document.getElementById(id);
    const values = [get("chat-automod-enabled").checked,get("chat-automod-enforcement").checked,
      Number(get("chat-automod-spam10").value),Number(get("chat-automod-spam60").value),
      Number(get("chat-automod-newspam10").value),Number(get("chat-automod-newspam60").value),
      Number(get("chat-automod-mentions").value),Number(get("chat-automod-newmentions").value),
      Number(get("chat-automod-links").value),Number(get("chat-automod-newlinks").value),
      Number(get("chat-automod-links10m").value),Number(get("chat-automod-newlinks10m").value)];
    const { error } = await AuthSystem.client.rpc("chat_admin_set_automod", {
      p_enabled:values[0],p_enforcement:values[1],p_spam10:values[2],p_spam60:values[3],p_newspam10:values[4],p_newspam60:values[5],p_mentions:values[6],p_newmentions:values[7],p_links:values[8],p_newlinks:values[9],p_links10m:values[10],p_newlinks10m:values[11]
    });
    const status=get("chat-automod-config-status"); if(status) status.textContent=error ? error.message : "AutoMod settings saved.";
    if (!error) await this.loadAutomodStats();
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
