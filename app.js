// Dual Message Secret Chat PWA Engine

// State
const cfg = window.APP_CONFIG || {};
const state = {
  unlocked: false,
  pin: cfg.defaultPin || '1234',
  roomId: cfg.roomId || 'our-secret-space',
  role: localStorage.getItem('quick_note_role') || 'user1',
  firebaseConfig: cfg.firebase || null,
  messages: [],
  dbRef: null,
  pinRef: null,
  enteredPin: ''
};

// Simple XOR + Base64 encryption with the shared PIN so secret messages aren't plain text in the cloud
function encryptWithPin(text, pin) {
  if (!text) return '';
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i) ^ pin.charCodeAt(i % pin.length);
    result += String.fromCharCode(charCode);
  }
  return btoa(encodeURIComponent(result));
}

function decryptWithPin(cipher, pin) {
  if (!cipher) return '';
  try {
    const decoded = decodeURIComponent(atob(cipher));
    let result = '';
    for (let i = 0; i < decoded.length; i++) {
      const charCode = decoded.charCodeAt(i) ^ pin.charCodeAt(i % pin.length);
      result += String.fromCharCode(charCode);
    }
    return result;
  } catch (e) {
    return '***';
  }
}

// Elements
const chatMessagesEl = document.getElementById('chatMessages');
const fakeInput = document.getElementById('fakeInput');
const secretInput = document.getElementById('secretInput');
const secretInputWrapper = document.getElementById('secretInputWrapper');
const toggleSecretBtn = document.getElementById('toggleSecretBtn');
const sendBtn = document.getElementById('sendBtn');
const modeBadge = document.getElementById('modeBadge');
const lockIcon = document.getElementById('lockIcon');
const lockLabel = document.getElementById('lockLabel');
const pinModal = document.getElementById('pinModal');
const pinDots = document.getElementById('pinDots');
const cancelPinBtn = document.getElementById('cancelPinBtn');
const toastEl = document.getElementById('toast');
const partnerNameDisplay = document.getElementById('partnerNameDisplay');
const userAvatar = document.getElementById('userAvatar');
const connectionStatus = document.getElementById('connectionStatus');
const profileBtn = document.getElementById('profileBtn');
const panicScreen = document.getElementById('panicScreen');
const exitPanicBtn = document.getElementById('exitPanicBtn');

// Toast helper
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2500);
}

// Register Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((err) => {
    console.log('SW registration note:', err);
  });
}

// UI Setup
function initUI() {
  userAvatar.textContent = 'QN';
  partnerNameDisplay.textContent = 'Quick List';
  updateModeBadge();
}

function updateModeBadge() {
  if (state.unlocked) {
    modeBadge.className = 'mode-badge unlocked';
    lockIcon.textContent = '⭐';
    lockLabel.textContent = 'Premium Active';
  } else {
    modeBadge.className = 'mode-badge locked';
    lockIcon.textContent = '⭐';
    lockLabel.textContent = 'Go Premium';
  }
}

// Toggle Note Field
toggleSecretBtn.addEventListener('click', () => {
  const isActive = secretInputWrapper.classList.toggle('active');
  toggleSecretBtn.classList.toggle('active', isActive);
  if (isActive) {
    secretInput.focus();
    toggleSecretBtn.innerHTML = '<span>✕ Remove Note</span>';
  } else {
    secretInput.value = '';
    toggleSecretBtn.innerHTML = '<span>+ Attach Note</span>';
  }
});

// Render Messages
function renderMessages() {
  chatMessagesEl.innerHTML = '';

  if (state.messages.length === 0) {
    const emptyNotice = document.createElement('div');
    emptyNotice.style.textAlign = 'center';
    emptyNotice.style.padding = '40px 20px';
    emptyNotice.style.color = 'var(--text-muted)';
    emptyNotice.style.fontSize = '13px';
    emptyNotice.innerHTML = `
      <div style="font-size: 28px; margin-bottom: 8px;">📝</div>
      <div>Channel is empty.</div>
      <div style="margin-top: 4px;">Type a message below to start.</div>
    `;
    chatMessagesEl.appendChild(emptyNotice);
    return;
  }

  state.messages.forEach((msg) => {
    const row = document.createElement('div');
    row.className = 'message-row';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.setAttribute('data-id', msg.id || '');
    if (msg.key) bubble.setAttribute('data-key', msg.key);

    // Decide what text to show
    let displayText = msg.fakeText;
    let isShowingSecret = false;

    if (state.unlocked && msg.encryptedSecret) {
      const decrypted = decryptWithPin(msg.encryptedSecret, state.pin);
      if (decrypted) {
        displayText = decrypted;
        isShowingSecret = true;
        bubble.classList.add('is-secret');
      }
    }

    const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    bubble.innerHTML = `
      <div class="msg-meta-header">
        <span class="msg-sender-tag">Note</span>
        <span>${timeStr} ${msg.encryptedSecret && !state.unlocked ? '<span style="opacity:0.35;">•</span>' : ''}</span>
      </div>
      <div class="msg-content">${escapeHTML(displayText)}</div>
    `;

    // Permanent delete on double click / double tap
    let lastTap = 0;
    bubble.addEventListener('touchend', (e) => {
      const currentTime = new Date().getTime();
      const tapLength = currentTime - lastTap;
      if (tapLength < 350 && tapLength > 0) {
        e.preventDefault();
        deleteNote(msg);
      }
      lastTap = currentTime;
    });

    bubble.addEventListener('dblclick', () => {
      deleteNote(msg);
    });

    row.appendChild(bubble);
    chatMessagesEl.appendChild(row);
  });

  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

// Permanent Delete Function
function deleteNote(msg) {
  if (state.dbRef) {
    if (msg.key) {
      state.dbRef.child(msg.key).remove().then(() => {
        showToast('Note deleted');
      }).catch((err) => {
        showToast('Delete error: ' + err.message);
      });
    } else {
      // Find by matching id field
      state.dbRef.orderByChild('id').equalTo(msg.id).once('value', (snapshot) => {
        if (snapshot.exists()) {
          snapshot.forEach((child) => {
            child.ref.remove();
          });
          showToast('Note deleted');
        }
      });
    }
  } else {
    // Local storage delete
    state.messages = state.messages.filter(m => m.id !== msg.id);
    localStorage.setItem('local_chat_' + state.roomId, JSON.stringify(state.messages));
    renderMessages();
    showToast('Note deleted');
  }
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// Send Message
function sendMessage() {
  const fakeText = fakeInput.value.trim();
  const secretText = secretInput.value.trim();

  if (!fakeText && !secretText) return;

  const msgPayload = {
    id: Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    sender: state.role,
    fakeText: fakeText || 'Alright, sounds good.',
    encryptedSecret: secretText ? encryptWithPin(secretText, state.pin) : null,
    timestamp: Date.now()
  };

  if (state.dbRef) {
    state.dbRef.push(msgPayload).catch((err) => {
      showToast('Sync error: ' + err.message);
    });
  } else {
    // Offline / Demo Local Mode
    state.messages.push(msgPayload);
    localStorage.setItem('local_chat_' + state.roomId, JSON.stringify(state.messages));
    renderMessages();
  }

  fakeInput.value = '';
  secretInput.value = '';
  secretInputWrapper.classList.remove('active');
  toggleSecretBtn.classList.remove('active');
  toggleSecretBtn.innerHTML = '<span>+ Attach Note</span>';
  fakeInput.focus();
}

sendBtn.addEventListener('click', sendMessage);
fakeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (secretInputWrapper.classList.contains('active')) {
      secretInput.focus();
    } else {
      sendMessage();
    }
  }
});
secretInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

// PIN Logic & Modal
modeBadge.addEventListener('click', () => {
  if (state.unlocked) {
    // Return to standard view
    state.unlocked = false;
    updateModeBadge();
    renderMessages();
    showToast('Premium mode paused');
  } else {
    // Open subscription key modal
    state.enteredPin = '';
    renderPinDots();
    pinModal.classList.add('open');
  }
});

cancelPinBtn.addEventListener('click', () => {
  pinModal.classList.remove('open');
  state.enteredPin = '';
});

function renderPinDots() {
  const dots = pinDots.querySelectorAll('.dot');
  dots.forEach((dot, idx) => {
    if (idx < state.enteredPin.length) {
      dot.classList.add('filled');
    } else {
      dot.classList.remove('filled');
    }
  });
}

function handlePinInput(char) {
  if (state.enteredPin.length < 4) {
    state.enteredPin += String(char).toLowerCase();
    renderPinDots();

    if (state.enteredPin.length === 4) {
      setTimeout(() => {
        if (state.enteredPin.toLowerCase() === String(state.pin).toLowerCase()) {
          state.unlocked = true;
          pinModal.classList.remove('open');
          updateModeBadge();
          renderMessages();
          showToast('Premium features activated');
        } else {
          showToast('Invalid subscription key');
          state.enteredPin = '';
          renderPinDots();
        }
      }, 150);
    }
  }
}

document.querySelectorAll('#keypad .key-btn[data-key]').forEach((btn) => {
  btn.addEventListener('click', () => {
    handlePinInput(btn.getAttribute('data-key'));
  });
});

document.getElementById('keyClear').addEventListener('click', () => {
  state.enteredPin = '';
  renderPinDots();
});

document.getElementById('keyBack').addEventListener('click', () => {
  state.enteredPin = state.enteredPin.slice(0, -1);
  renderPinDots();
});

// Quick Panic Disguise screen on tap header avatar
profileBtn.addEventListener('click', () => {
  panicScreen.classList.add('active');
  state.unlocked = false;
  updateModeBadge();
  renderMessages();
});

exitPanicBtn.addEventListener('click', () => {
  panicScreen.classList.remove('active');
});

// Initialize Firebase Realtime Database
function initFirebase() {
  const hasConfig = state.firebaseConfig && state.firebaseConfig.apiKey && state.firebaseConfig.databaseURL;
  if (!hasConfig) {
    connectionStatus.textContent = 'All notes synced';
    connectionStatus.style.color = 'var(--text-muted)';
    
    // Load local storage fallback messages for testing
    const saved = localStorage.getItem('local_chat_' + state.roomId);
    if (saved) {
      try {
        state.messages = JSON.parse(saved);
      } catch (e) {
        state.messages = [];
      }
    } else {
      // Add default welcome example
      state.messages = [
        {
          id: 'welcome_1',
          sender: 'user2',
          fakeText: 'Meeting reschedule: moved to 4:30 PM tomorrow.',
          encryptedSecret: encryptWithPin('Hey! I love you so much ❤️', state.pin),
          timestamp: Date.now() - 3600000
        }
      ];
    }
    renderMessages();
    return;
  }

  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(state.firebaseConfig);
    }
    const db = firebase.database();
    state.dbRef = db.ref('rooms/' + state.roomId + '/messages');
    
    // Pre-shared key fetched directly from database (under auth_pin)
    state.pinRef = db.ref('rooms/' + state.roomId + '/auth_pin');
    state.pinRef.on('value', (snap) => {
      const dbPin = snap.val();
      if (dbPin) {
        state.pin = String(dbPin);
        if (state.unlocked) renderMessages();
      }
    });

    connectionStatus.textContent = 'Syncing...';
    connectionStatus.style.color = '#38bdf8';

    state.dbRef.limitToLast(100).on('value', (snapshot) => {
      state.messages = [];
      if (snapshot.exists()) {
        snapshot.forEach((child) => {
          const item = child.val();
          item.key = child.key;
          state.messages.push(item);
        });
      }
      connectionStatus.textContent = 'All notes synced';
      connectionStatus.style.color = 'var(--text-muted)';
      renderMessages();
    }, (error) => {
      console.error('Database sync error:', error);
      connectionStatus.textContent = 'Sync offline';
      connectionStatus.style.color = 'var(--text-muted)';
    });

  } catch (err) {
    console.error('Firebase initialization:', err);
    connectionStatus.textContent = 'All notes synced';
    connectionStatus.style.color = 'var(--text-muted)';
  }
}

// Startup
initUI();
initFirebase();
renderMessages();
