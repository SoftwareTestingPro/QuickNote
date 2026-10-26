// Dual Message Secret Chat PWA Engine

// State
const cfg = window.APP_CONFIG || {};
const state = {
  unlocked: false,
  // Only the cryptographic one-way SHA-256 hash is stored
  pinHash: cfg.pinHash || '22cf79c3e77d6476dd6eb433b77e1d998023a55bf41fb480f7d79db0266ec8c7',
  activePin: '', // Only kept in temporary memory while actively unlocked, wiped on lock
  roomId: cfg.roomId || 'our-secret-space',
  role: localStorage.getItem('quick_note_role') || 'user1',
  firebaseConfig: cfg.firebase || null,
  messages: [],
  dbRef: null,
  pinRef: null,
  callsRef: null,
  enteredPin: ''
};

// Fast native Web Crypto SHA-256 hashing
async function hashPin(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(String(pin).toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// WebRTC & Call State
const callState = {
  peerConnection: null,
  localStream: null,
  currentCallId: null,
  isCaller: false,
  isCallActive: false,
  timerInterval: null,
  startTime: null,
  ringtoneAudio: null
};

// Free public STUN servers for NAT traversal
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
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
const privacyShield = document.getElementById('privacyShield');
const callBtn = document.getElementById('callBtn');
const callOverlay = document.getElementById('callOverlay');
const callAvatar = document.getElementById('callAvatar');
const callTitle = document.getElementById('callTitle');
const callStatusText = document.getElementById('callStatusText');
const callDuration = document.getElementById('callDuration');
const callIncomingActions = document.getElementById('callIncomingActions');
const callActiveActions = document.getElementById('callActiveActions');
const acceptCallBtn = document.getElementById('acceptCallBtn');
const declineCallBtn = document.getElementById('declineCallBtn');
const hangupCallBtn = document.getElementById('hangupCallBtn');
const toggleMuteBtn = document.getElementById('toggleMuteBtn');
const toggleSpeakerBtn = document.getElementById('toggleSpeakerBtn');
const speakerBtnIcon = document.getElementById('speakerBtnIcon');
const callModePill = document.getElementById('callModePill');
const callModePillIcon = document.getElementById('callModePillIcon');
const callModePillText = document.getElementById('callModePillText');
const remoteAudio = document.getElementById('remoteAudio');
const roleBtnUser1 = document.getElementById('roleBtnUser1');
const roleBtnUser2 = document.getElementById('roleBtnUser2');

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
  partnerNameDisplay.textContent = 'Quick Note';
  updateRoleUI();
  updateModeBadge();
}

function updateRoleUI() {
  if (roleBtnUser1 && roleBtnUser2) {
    if (state.role === 'user2') {
      roleBtnUser2.classList.add('active');
      roleBtnUser1.classList.remove('active');
    } else {
      roleBtnUser1.classList.add('active');
      roleBtnUser2.classList.remove('active');
    }
  }
}

if (roleBtnUser1 && roleBtnUser2) {
  roleBtnUser1.addEventListener('click', () => {
    state.role = 'user1';
    localStorage.setItem('quick_note_role', 'user1');
    updateRoleUI();
    renderMessages();
    showToast('Device identity set to User 1');
  });

  roleBtnUser2.addEventListener('click', () => {
    state.role = 'user2';
    localStorage.setItem('quick_note_role', 'user2');
    updateRoleUI();
    renderMessages();
    showToast('Device identity set to User 2');
  });
}

function updateModeBadge() {
  if (state.unlocked) {
    modeBadge.className = 'mode-badge unlocked';
    lockIcon.textContent = '⭐';
    lockLabel.textContent = 'Premium Active';
    if (callBtn) callBtn.classList.remove('hidden');
  } else {
    modeBadge.className = 'mode-badge locked';
    lockIcon.textContent = '⭐';
    lockLabel.textContent = 'Go Premium';
    if (callBtn) callBtn.classList.add('hidden');
    // If locked while in a call or incoming call, safely end/decline
    if (callState.isCallActive || callState.currentCallId) {
      endCall();
    }
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
      <div>No items in your list.</div>
      <div style="margin-top: 4px;">Add an item below to get started.</div>
    `;
    chatMessagesEl.appendChild(emptyNotice);
    return;
  }

  state.messages.forEach((msg) => {
    const isMe = msg.sender === state.role;
    const row = document.createElement('div');
    row.className = `message-row ${isMe ? 'msg-row-me' : 'msg-row-them'}`;

    const bubble = document.createElement('div');
    bubble.className = `msg-bubble ${isMe ? 'bubble-me' : 'bubble-them'}`;
    bubble.setAttribute('data-id', msg.id || '');
    if (msg.key) bubble.setAttribute('data-key', msg.key);

    // Decide what text to show
    let displayText = msg.fakeText;
    let isShowingSecret = false;

    if (state.unlocked && msg.encryptedSecret && state.activePin) {
      const decrypted = decryptWithPin(msg.encryptedSecret, state.activePin);
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

const GROCERY_ITEMS = [
  // Fruits
  'Apples', 'Bananas', 'Oranges', 'Strawberries', 'Blueberries', 'Grapes',
  'Watermelon', 'Mangoes', 'Pineapple', 'Peaches', 'Pears', 'Kiwi',
  'Plums', 'Cherries', 'Raspberries', 'Blackberries', 'Pomegranate', 'Cantaloupe',
  'Papaya', 'Lemons', 'Limes', 'Grapefruit', 'Figs', 'Apricots',

  // Vegetables & Greens
  'Tomatoes', 'Potatoes', 'Sweet potatoes', 'Red onions', 'Yellow onions',
  'Garlic', 'Carrots', 'Broccoli', 'Spinach', 'Cucumbers', 'Bell peppers',
  'Avocados', 'Button mushrooms', 'Lettuce', 'Kale', 'Zucchini', 'Cauliflower',
  'Cabbage', 'Green beans', 'Asparagus', 'Celery', 'Ginger', 'Chili peppers',
  'Coriander', 'Mint leaves', 'Basil', 'Spring onions', 'Beetroot', 'Corn',

  // Dairy & Refrigerated
  'Whole milk', 'Oat milk', 'Almond milk', 'Greek yogurt', 'Cheddar cheese',
  'Mozzarella', 'Butter', 'Eggs', 'Heavy cream', 'Tofu', 'Cottage cheese',
  'Sour cream', 'Parmesan',

  // Bakery & Breakfast
  'Sourdough bread', 'Whole wheat bread', 'Bagels', 'Tortillas', 'Rolled oats',
  'Granola', 'Pancake mix', 'Croissants', 'English muffins',

  // Pantry & Staples
  'Basmati rice', 'Brown rice', 'Quinoa', 'Pasta', 'Spaghetti', 'Noodles',
  'Olive oil', 'Coconut oil', 'Sesame oil', 'Apple cider vinegar', 'Soy sauce',
  'Tomato sauce', 'Peanut butter', 'Honey', 'Maple syrup', 'Black pepper',
  'Sea salt', 'Cumin powder', 'Turmeric', 'Cinnamon', 'Chia seeds',

  // Nuts, Snacks & Beverages
  'Almonds', 'Walnuts', 'Cashews', 'Pistachios', 'Dark chocolate',
  'Coffee beans', 'Green tea', 'Earl Grey tea', 'Sparkling water', 'Orange juice'
];

function getRandomGroceryItem() {
  const existingItems = new Set(
    state.messages
      .map(m => (m.fakeText || '').trim().toLowerCase())
      .filter(Boolean)
  );

  const available = GROCERY_ITEMS.filter(item => !existingItems.has(item.toLowerCase()));
  const pool = available.length > 0 ? available : GROCERY_ITEMS;
  const randomIndex = Math.floor(Math.random() * pool.length);
  return pool[randomIndex];
}

// State for pending secret message when user submits a note without unlocking first
let pendingSecretPayload = null;

// Send Message
function sendMessage() {
  const fakeText = fakeInput.value.trim();
  const secretText = secretInput.value.trim();

  if (!fakeText && !secretText) return;

  // If user entered a note but premium mode is locked, prompt for PIN first so the note can be encrypted
  if (secretText && (!state.unlocked || !state.activePin)) {
    pendingSecretPayload = {
      fakeText: fakeText,
      secretText: secretText
    };
    state.enteredPin = '';
    renderPinDots();
    pinModal.classList.add('open');
    showToast('Enter PIN to encrypt and send note');
    return;
  }

  doSendMessage(fakeText, secretText);
}

function doSendMessage(fakeText, secretText) {
  const msgPayload = {
    id: Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    sender: state.role,
    fakeText: fakeText || getRandomGroceryItem(),
    encryptedSecret: (secretText && state.activePin) ? encryptWithPin(secretText, state.activePin) : null,
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
  pendingSecretPayload = null;
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

async function handlePinInput(char) {
  if (state.enteredPin.length < 4) {
    state.enteredPin += String(char).toLowerCase();
    renderPinDots();

    if (state.enteredPin.length === 4) {
      const typedPin = state.enteredPin;
      const inputHash = await hashPin(typedPin);

      setTimeout(() => {
        if (inputHash === state.pinHash.toLowerCase()) {
          state.unlocked = true;
          state.activePin = typedPin; // Temporary in-memory key for decrypting/encrypting
          state.enteredPin = '';
          pinModal.classList.remove('open');
          updateModeBadge();

          // If user was sending a note when prompted for PIN, send it now with the active PIN encryption
          if (pendingSecretPayload) {
            const { fakeText, secretText } = pendingSecretPayload;
            pendingSecretPayload = null;
            doSendMessage(fakeText, secretText);
          } else {
            renderMessages();
          }

          resetInactivityTimer();
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

// Lock app to "Go Premium" standard disguised mode
function lockToDisguiseMode() {
  if (inactivityTimeout) {
    clearTimeout(inactivityTimeout);
    inactivityTimeout = null;
  }
  
  // Instant visual cover: veil screen synchronously so no frame can leak
  if (privacyShield) {
    privacyShield.classList.add('active');
  }

  state.unlocked = false;
  state.activePin = ''; // Wipe plaintext PIN from memory immediately
  state.enteredPin = '';

  if (pinModal) pinModal.classList.remove('open');
  renderPinDots();
  updateModeBadge();
  renderMessages();

  // Remove privacy shield once DOM repaint has firmly settled as locked
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (privacyShield) {
        privacyShield.classList.remove('active');
      }
    });
  });
}

// Auto-lock listeners:
// 1. window 'blur' triggers the instant the power/lock button is pressed, home button tapped, or notification shade pulled down
window.addEventListener('blur', () => {
  lockToDisguiseMode();
});

// 2. document visibilitychange triggers when screen turns off or tab hidden
document.addEventListener('visibilitychange', () => {
  if (document.hidden || document.visibilityState !== 'visible') {
    lockToDisguiseMode();
  } else {
    // When screen turns back on / wakes up, strictly enforce locked disguised state
    if (!state.unlocked) {
      updateModeBadge();
      renderMessages();
    }
  }
});

// 3. window 'focus' and 'pageshow' guarantee that upon phone wake/unlock, the app is 100% locked
window.addEventListener('focus', () => {
  if (!state.unlocked) {
    updateModeBadge();
    renderMessages();
  }
});

window.addEventListener('pageshow', (event) => {
  // If restored from bfcache or waking up, ensure locked state
  lockToDisguiseMode();
});

// 4. pagehide triggers when navigating away or app process suspended
window.addEventListener('pagehide', () => {
  lockToDisguiseMode();
});

// 5. document 'freeze' (Page Lifecycle API)
document.addEventListener('freeze', () => {
  lockToDisguiseMode();
});

// 5. Inactivity Auto-Lock: if user stops touching/typing for 45 seconds while unlocked, lock automatically
let inactivityTimeout = null;
function resetInactivityTimer() {
  if (inactivityTimeout) clearTimeout(inactivityTimeout);
  if (state.unlocked) {
    inactivityTimeout = setTimeout(() => {
      // Don't auto-lock mid-call
      if (!callState.isCallActive && !callState.currentCallId) {
        lockToDisguiseMode();
        showToast('App locked due to inactivity');
      }
    }, 45000); // 45 seconds
  }
}

['touchstart', 'mousedown', 'keydown', 'scroll'].forEach(evt => {
  window.addEventListener(evt, resetInactivityTimer, { passive: true });
});

// Quick Panic Disguise screen on tap header avatar
profileBtn.addEventListener('click', () => {
  panicScreen.classList.add('active');
  lockToDisguiseMode();
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
          encryptedSecret: null,
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
    
    // Pre-shared key fetched from database (can be raw pin or already hashed sha-256)
    state.pinRef = db.ref('rooms/' + state.roomId + '/auth_pin');
    state.pinRef.on('value', async (snap) => {
      const val = snap.val();
      if (val) {
        const strVal = String(val).trim();
        // If it's already a 64-character SHA-256 hex string, use directly; otherwise hash it
        if (/^[a-fA-F0-9]{64}$/.test(strVal)) {
          state.pinHash = strVal.toLowerCase();
        } else {
          state.pinHash = await hashPin(strVal);
        }
      }
    });

    connectionStatus.textContent = 'Syncing...';
    connectionStatus.style.color = '#38bdf8';

    // Call signaling reference
    state.callsRef = db.ref('rooms/' + state.roomId + '/calls');
    listenForIncomingCalls();

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

// ----------------------------------------------------
// WebRTC Internet Calling Implementation
// ----------------------------------------------------

// Tone Synthesizer for Ringtone (No external audio files needed)
let ringtoneInterval = null;
let activeOscillators = [];

function playRingtone() {
  stopRingtone(); // ensure any prior tone or context is completely torn down
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    callState.ringtoneCtx = audioCtx;

    function beep() {
      if (!callState.ringtoneCtx || callState.ringtoneCtx.state === 'closed') return;
      try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        activeOscillators.push(osc);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, audioCtx.currentTime); // 440Hz A tone
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 1.2);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 1.2);

        osc.onended = () => {
          const idx = activeOscillators.indexOf(osc);
          if (idx !== -1) activeOscillators.splice(idx, 1);
        };
      } catch (e) {
        console.warn('Beep trigger note:', e);
      }
    }

    beep();
    ringtoneInterval = setInterval(beep, 3000);
  } catch (e) {
    console.warn('AudioContext ringtone error:', e);
  }
}

function stopRingtone() {
  if (ringtoneInterval) {
    clearInterval(ringtoneInterval);
    ringtoneInterval = null;
  }
  // Stop all active oscillator nodes immediately
  while (activeOscillators.length > 0) {
    const osc = activeOscillators.pop();
    try {
      osc.stop();
      osc.disconnect();
    } catch (e) {}
  }
  if (callState.ringtoneCtx) {
    try {
      callState.ringtoneCtx.close();
    } catch (e) {}
    callState.ringtoneCtx = null;
  }
}

// Format call timer 00:00
function startCallTimer() {
  callState.startTime = Date.now();
  callDuration.classList.add('active');
  callDuration.textContent = '00:00';
  if (callState.timerInterval) clearInterval(callState.timerInterval);
  callState.timerInterval = setInterval(() => {
    const diff = Math.floor((Date.now() - callState.startTime) / 1000);
    const mins = String(Math.floor(diff / 60)).padStart(2, '0');
    const secs = String(diff % 60).padStart(2, '0');
    callDuration.textContent = `${mins}:${secs}`;
  }, 1000);
}

function stopCallTimer() {
  if (callState.timerInterval) {
    clearInterval(callState.timerInterval);
    callState.timerInterval = null;
  }
  callDuration.classList.remove('active');
  callDuration.textContent = '00:00';
}

// Listen for incoming calls
function listenForIncomingCalls() {
  if (!state.callsRef) return;

  state.callsRef.on('value', async (snapshot) => {
    const callData = snapshot.val();

    // If call was removed or ended
    if (!callData) {
      if (callState.isCallActive || callState.currentCallId) {
        cleanupCallUI();
        showToast('Call ended');
      }
      return;
    }

    const { status, caller, offer, answer } = callData;

    // Incoming Call for current user
    if (status === 'ringing' && caller !== state.role) {
      // Auto-unlock to reveal incoming call if pin was previously activated, or prompt call directly
      state.unlocked = true;
      updateModeBadge();
      renderMessages();
      showIncomingCallUI();
    }

    // Caller receives acceptance from Receiver
    if (status === 'connected' && callState.isCaller && answer && callState.peerConnection) {
      if (!callState.isCallActive) {
        callState.isCallActive = true;
        stopRingtone();
        try {
          await callState.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (err) {
          console.warn('Set remote desc error:', err);
        }
        callStatusText.textContent = 'Connected';
        callAvatar.classList.remove('ringing');
        startCallTimer();
        applyAudioOutputMode();
      }
    }

    // Call declined or ended
    if (status === 'declined' || status === 'ended') {
      cleanupCallUI();
      showToast(status === 'declined' ? 'Call declined' : 'Call ended');
    }
  });

  // Candidate listeners
  state.callsRef.child('candidates').on('child_added', (snap) => {
    const data = snap.val();
    if (data && data.sender !== state.role && callState.peerConnection) {
      callState.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate)).catch((e) => {
        console.warn('Add ICE candidate note:', e);
      });
    }
  });
}

// Audio constraints tuned specifically for telephony voice calls (signals OS to route to earpiece)
const CALL_AUDIO_CONSTRAINTS = {
  audio: {
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
    autoGainControl: { ideal: true },
    channelCount: 1, // Mono channel indicates standard phone call to Android/iOS
    sampleRate: { ideal: 16000 },
    latency: { ideal: 0.01 }
  },
  video: false
};

// Start Call (Outgoing)
async function startOutgoingCall() {
  if (!state.unlocked) return;
  if (!state.callsRef) {
    showToast('Firebase connection required for internet calls');
    return;
  }

  try {
    // 1. Get speech-optimized telephony audio media
    const stream = await navigator.mediaDevices.getUserMedia(CALL_AUDIO_CONSTRAINTS);
    callState.localStream = stream;

    // 2. Setup WebRTC PeerConnection
    setupPeerConnection();
    stream.getTracks().forEach(track => callState.peerConnection.addTrack(track, stream));

    // 3. Create Offer
    const offer = await callState.peerConnection.createOffer();
    await callState.peerConnection.setLocalDescription(offer);

    callState.isCaller = true;
    callState.currentCallId = 'active_call';

    // 4. Push call state to Firebase and clean candidates
    await state.callsRef.set({
      status: 'ringing',
      caller: state.role,
      offer: {
        type: offer.type,
        sdp: offer.sdp
      },
      timestamp: Date.now()
    });
    // Remove old candidates
    state.callsRef.child('candidates').remove().catch(() => {});

    // 5. Update UI
    callTitle.textContent = 'Calling...';
    callStatusText.textContent = 'Ringing partner...';
    callAvatar.classList.add('ringing');
    callIncomingActions.classList.add('hidden');
    callActiveActions.classList.remove('hidden');
    callOverlay.classList.add('active');
    applyAudioOutputMode();
    playRingtone();

  } catch (err) {
    console.error('Call initialization failed:', err);
    if (err.name === 'NotAllowedError') {
      showToast('Microphone access denied. Please allow microphone in browser.');
    } else {
      showToast('Could not start call: ' + err.message);
    }
    cleanupCallUI();
  }
}

// Display incoming call prompt
function showIncomingCallUI() {
  callTitle.textContent = 'Incoming Call';
  callStatusText.textContent = 'Voice Call from Partner';
  callAvatar.classList.add('ringing');
  callIncomingActions.classList.remove('hidden');
  callActiveActions.classList.add('hidden');
  callDuration.classList.remove('active');
  callOverlay.classList.add('active');
  playRingtone();
}

// Accept incoming call
async function acceptCall() {
  stopRingtone();
  callStatusText.textContent = 'Connecting...';
  callIncomingActions.classList.add('hidden');
  callActiveActions.classList.remove('hidden');

  try {
    const stream = await navigator.mediaDevices.getUserMedia(CALL_AUDIO_CONSTRAINTS);
    callState.localStream = stream;

    setupPeerConnection();
    stream.getTracks().forEach(track => callState.peerConnection.addTrack(track, stream));

    // Fetch the caller's offer
    const snap = await state.callsRef.once('value');
    const callData = snap.val();

    if (!callData || !callData.offer) {
      throw new Error('Call already cancelled');
    }

    await callState.peerConnection.setRemoteDescription(new RTCSessionDescription(callData.offer));
    const answer = await callState.peerConnection.createAnswer();
    await callState.peerConnection.setLocalDescription(answer);

    // Update Firebase with answer
    await state.callsRef.update({
      status: 'connected',
      answer: {
        type: answer.type,
        sdp: answer.sdp
      }
    });

    callState.isCallActive = true;
    callStatusText.textContent = 'Connected';
    callAvatar.classList.remove('ringing');
    startCallTimer();
    applyAudioOutputMode();

  } catch (err) {
    console.error('Accept call failed:', err);
    showToast('Failed to accept: ' + err.message);
    endCall();
  }
}

// Decline incoming call
function declineCall() {
  stopRingtone();
  if (state.callsRef) {
    state.callsRef.update({ status: 'declined' }).then(() => {
      setTimeout(() => state.callsRef.remove(), 1000);
    });
  }
  cleanupCallUI();
}

// End / Hangup Call
function endCall() {
  stopRingtone();
  stopCallTimer();
  if (state.callsRef) {
    state.callsRef.update({ status: 'ended' }).then(() => {
      setTimeout(() => state.callsRef.remove(), 1000);
    });
  }
  cleanupCallUI();
}

// Setup PeerConnection & ICE Handlers
function setupPeerConnection() {
  if (callState.peerConnection) {
    try { callState.peerConnection.close(); } catch (e) {}
  }

  const pc = new RTCPeerConnection(rtcConfig);
  callState.peerConnection = pc;

  pc.onicecandidate = (event) => {
    if (event.candidate && state.callsRef) {
      state.callsRef.child('candidates').push({
        sender: state.role,
        candidate: event.candidate.toJSON()
      });
    }
  };

  pc.ontrack = (event) => {
    if (remoteAudio && event.streams && event.streams[0]) {
      remoteAudio.srcObject = event.streams[0];
      remoteAudio.play().catch(e => console.warn('Remote audio autoplay error:', e));
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      cleanupCallUI();
    }
  };
}

// Toggle Mute
let isMuted = false;
function toggleMute() {
  if (callState.localStream) {
    const audioTrack = callState.localStream.getAudioTracks()[0];
    if (audioTrack) {
      isMuted = !isMuted;
      audioTrack.enabled = !isMuted;
      toggleMuteBtn.classList.toggle('muted', isMuted);
      showToast(isMuted ? 'Microphone Muted' : 'Microphone Unmuted');
    }
  }
}

// Speakerphone vs Earpiece routing state ('earpiece' default for phone calls)
let audioOutputMode = 'earpiece'; // 'earpiece' | 'speaker'

async function applyAudioOutputMode() {
  if (!remoteAudio) return;

  // 1. Programmatic sink selection (Chrome Desktop & supported mobile platforms)
  if (typeof remoteAudio.setSinkId === 'function') {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioOutputs = devices.filter(d => d.kind === 'audiooutput');

      if (audioOutputMode === 'earpiece') {
        // Look for earpiece / internal receiver
        const earpiece = audioOutputs.find(d => 
          /earpiece|receiver|phone|handset/i.test(d.label)
        );
        if (earpiece) {
          await remoteAudio.setSinkId(earpiece.deviceId);
        } else if (audioOutputs.length > 0) {
          // If no explicitly named earpiece, default sink
          await remoteAudio.setSinkId(audioOutputs[0].deviceId);
        }
      } else {
        // Speakerphone mode: Look for speaker / loudspeaker
        const speaker = audioOutputs.find(d => 
          /speaker|loudspeaker|external/i.test(d.label)
        );
        if (speaker) {
          await remoteAudio.setSinkId(speaker.deviceId);
        } else {
          await remoteAudio.setSinkId('');
        }
      }
    } catch (e) {
      console.warn('setSinkId notice:', e);
    }
  }

  // 2. Adjust volume curve to prevent loud blasts when in earpiece mode
  if (audioOutputMode === 'earpiece') {
    remoteAudio.volume = 0.65;
    if (toggleSpeakerBtn) {
      toggleSpeakerBtn.className = 'call-action-btn speaker-toggle earpiece';
      toggleSpeakerBtn.title = 'Current: Earpiece Mode (Tap for Loudspeaker)';
    }
    if (speakerBtnIcon) speakerBtnIcon.textContent = '👂';
    if (callModePill) {
      callModePill.className = 'call-mode-pill';
      if (callModePillIcon) callModePillIcon.textContent = '👂';
      if (callModePillText) callModePillText.textContent = 'Earpiece Mode';
    }
  } else {
    remoteAudio.volume = 1.0;
    if (toggleSpeakerBtn) {
      toggleSpeakerBtn.className = 'call-action-btn speaker-toggle loudspeaker';
      toggleSpeakerBtn.title = 'Current: Loudspeaker (Tap for Earpiece)';
    }
    if (speakerBtnIcon) speakerBtnIcon.textContent = '🔊';
    if (callModePill) {
      callModePill.className = 'call-mode-pill speaker';
      if (callModePillIcon) callModePillIcon.textContent = '🔊';
      if (callModePillText) callModePillText.textContent = 'Loudspeaker Mode';
    }
  }
}

async function toggleAudioOutput() {
  audioOutputMode = (audioOutputMode === 'earpiece') ? 'speaker' : 'earpiece';
  await applyAudioOutputMode();
  showToast(audioOutputMode === 'earpiece' ? 'Switched to Earpiece Mode' : 'Switched to Speakerphone');
}

// Reset Call UI and local hardware
function cleanupCallUI() {
  stopRingtone();
  stopCallTimer();

  if (callState.localStream) {
    try {
      callState.localStream.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
    } catch (e) {}
    callState.localStream = null;
  }

  if (callState.peerConnection) {
    try {
      // Stop all senders and transceivers to immediately kill hardware pipeline
      callState.peerConnection.getSenders().forEach(sender => {
        if (sender.track) {
          sender.track.stop();
          sender.track.enabled = false;
        }
      });
      callState.peerConnection.getReceivers().forEach(receiver => {
        if (receiver.track) {
          receiver.track.stop();
          receiver.track.enabled = false;
        }
      });
      callState.peerConnection.close();
    } catch (e) {}
    callState.peerConnection = null;
  }

  if (remoteAudio) {
    try {
      remoteAudio.pause();
      if (remoteAudio.srcObject) {
        const stream = remoteAudio.srcObject;
        if (stream.getTracks) {
          stream.getTracks().forEach(t => {
            t.stop();
            t.enabled = false;
          });
        }
      }
      remoteAudio.srcObject = null;
      remoteAudio.removeAttribute('src');
      remoteAudio.load();
    } catch (e) {}
  }

  callState.isCallActive = false;
  callState.currentCallId = null;
  callState.isCaller = false;
  isMuted = false;
  audioOutputMode = 'earpiece';
  toggleMuteBtn.classList.remove('muted');
  if (toggleSpeakerBtn) {
    toggleSpeakerBtn.className = 'call-action-btn speaker-toggle earpiece';
  }
  if (speakerBtnIcon) speakerBtnIcon.textContent = '👂';
  if (callModePill) {
    callModePill.className = 'call-mode-pill';
    if (callModePillIcon) callModePillIcon.textContent = '👂';
    if (callModePillText) callModePillText.textContent = 'Earpiece Mode';
  }
  callAvatar.classList.remove('ringing');
  callOverlay.classList.remove('active');
}

// Call Button Click Event
if (callBtn) {
  callBtn.addEventListener('click', () => {
    if (state.unlocked) {
      startOutgoingCall();
    } else {
      showToast('Unlock required');
    }
  });
}

acceptCallBtn.addEventListener('click', acceptCall);
declineCallBtn.addEventListener('click', declineCall);
hangupCallBtn.addEventListener('click', endCall);
toggleMuteBtn.addEventListener('click', toggleMute);
if (toggleSpeakerBtn) {
  toggleSpeakerBtn.addEventListener('click', toggleAudioOutput);
}

// Startup
initUI();
initFirebase();
renderMessages();

