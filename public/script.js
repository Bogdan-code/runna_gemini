
/**
 * RUNNA PRO COACH - CLIENT-SIDE APPLICATION ENGINE
 * Features:
 * - Multi-User Auth & Profile Sync (Firebase Auth & Firestore + Robust LocalStorage Fallback)
 * - Runna-Style Algorithmic Plan Generator (Progressive Blocks, Periodization, Pace Zones)
 * - Interactive Schedule Dashboard with Week-by-Week Navigation & Completion Tracking
 * - Workout Detail Modal with Step-by-Step Splits & Targets
 * - Live Interactive Pacer & Interval Stopwatch with Web Audio API Cues
 * - Race Finish & Pace Calculator
 */

(function () {
  'use strict';

  /* ==========================================================================
     1. STATE MANAGEMENT & CONSTANTS
     ========================================================================== */

  const STATE = {
    currentUser: null,
    activePlan: null,
    currentWeekIndex: 0,
    selectedWorkout: null,
    firebaseApp: null,
    firebaseAuth: null,
    firestoreDb: null,
    isFirebaseLive: false,
    timer: {
      intervalId: null,
      isRunning: false,
      elapsedSeconds: 0,
      currentStepIndex: 0,
      steps: [],
      soundEnabled: true
    }
  };

  const DAYS_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const STORAGE_KEYS = {
    FIREBASE_CONFIG: 'runna_firebase_config',
    LOCAL_USERS: 'runna_local_users',
    ACTIVE_USER_ID: 'runna_active_user_id',
    USER_PLANS_PREFIX: 'runna_plan_'
  };

  /* Default demo runner for instant testing */
  const DEMO_USER = {
    uid: 'demo-runner-001',
    email: 'runner@runna.pro',
    displayName: 'Alex Morgan',
    units: 'km',
    baseline5kSeconds: 1590, // 26:30 min (5:18 min/km)
    goalDistance: '10k',
    goalAmbition: 'improve',
    frequencyDays: 4,
    preferredDays: ['Tue', 'Thu', 'Sat', 'Sun'],
    planWeeks: 12,
    completedWorkouts: {}
  };

  /* ==========================================================================
     2. AUDIO SYNTHESIS FOR PACER / STOPWATCH (Web Audio API)
     ========================================================================== */

  class AudioBeepEngine {
    constructor() {
      this.audioCtx = null;
    }

    init() {
      if (!this.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          this.audioCtx = new AudioContext();
        }
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
    }

    playTone(frequency, duration, type = 'sine') {
      try {
        this.init();
        if (!this.audioCtx || !STATE.timer.soundEnabled) return;
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(frequency, this.audioCtx.currentTime);

        gain.gain.setValueAtTime(0.18, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start();
        osc.stop(this.audioCtx.currentTime + duration);
      } catch (e) {
        console.warn('Audio synthesis notice:', e);
      }
    }

    beepWarning() {
      this.playTone(880, 0.12, 'square'); // High warning beep
    }

    chimeStepStart() {
      // Ascending two-tone chime
      this.playTone(523.25, 0.12, 'sine'); // C5
      setTimeout(() => this.playTone(659.25, 0.25, 'sine'), 130); // E5
    }

    chimeCompleted() {
      // Triumphant chord
      this.playTone(523.25, 0.15, 'sine');
      setTimeout(() => this.playTone(659.25, 0.15, 'sine'), 150);
      setTimeout(() => this.playTone(783.99, 0.35, 'sine'), 300);
    }
  }

  const audioEngine = new AudioBeepEngine();

  /* ==========================================================================
     3. PACE & TRAINING ZONE ENGINE (VDOT & Daniels Running Formula Inspired)
     ========================================================================== */

  const PaceEngine = {
    // Converts seconds into M:SS or MM:SS format
    formatTime(totalSec) {
      if (isNaN(totalSec) || totalSec === null) return '0:00';
      const m = Math.floor(totalSec / 60);
      const s = Math.floor(totalSec % 60);
      return `${m}:${s < 10 ? '0' : ''}${s}`;
    },

    // Convert pace from min/km to min/mi
    kmToMiPace(secPerKm) {
      return Math.round(secPerKm * 1.60934);
    },

    // Calculate training zones based on 5k baseline pace in seconds/km
    calculateZones(base5kSecPerKm) {
      return [
        {
          id: 'zone-1',
          name: 'Easy / Recovery',
          effort: 'Zone 1-2 (65-75% HR)',
          desc: 'Conversational aerobic endurance; builds capillary density.',
          minSec: base5kSecPerKm + 55,
          maxSec: base5kSecPerKm + 85,
          color: 'var(--accent-cyan)'
        },
        {
          id: 'zone-2',
          name: 'Marathon / Aerobic Pace',
          effort: 'Zone 3 (75-82% HR)',
          desc: 'Rhythmic aerobic effort; key for long run steady states.',
          minSec: base5kSecPerKm + 30,
          maxSec: base5kSecPerKm + 45,
          color: 'var(--accent-volt)'
        },
        {
          id: 'zone-3',
          name: 'Tempo / Threshold',
          effort: 'Zone 4 (83-88% HR)',
          desc: 'Comfortably hard; raises lactate clearance threshold.',
          minSec: base5kSecPerKm + 10,
          maxSec: base5kSecPerKm + 20,
          color: 'var(--accent-orange)'
        },
        {
          id: 'zone-4',
          name: 'VO2 Max / 5K Pace',
          effort: 'Zone 5 (90-95% HR)',
          desc: 'Hard interval pace; maximizes cardiac stroke volume.',
          minSec: base5kSecPerKm - 5,
          maxSec: base5kSecPerKm + 5,
          color: 'var(--accent-red)'
        },
        {
          id: 'zone-5',
          name: 'Repetition / Speed',
          effort: 'Zone 5+ (>95% HR)',
          desc: 'Anaerobic power, running economy, and leg turnover.',
          minSec: base5kSecPerKm - 25,
          maxSec: base5kSecPerKm - 15,
          color: 'var(--accent-purple)'
        }
      ];
    },

    formatPaceString(minSec, maxSec, units = 'km') {
      if (units === 'mi') {
        const miMin = this.kmToMiPace(minSec);
        const miMax = this.kmToMiPace(maxSec);
        return `${this.formatTime(miMin)} - ${this.formatTime(miMax)} /mi`;
      }
      return `${this.formatTime(minSec)} - ${this.formatTime(maxSec)} /km`;
    }
  };

  /* ==========================================================================
     4. RUNNA PLAN GENERATOR ALGORITHM
     ========================================================================== */

  const PlanGenerator = {
    generatePlan(userProfile) {
      const {
        goalDistance = '10k',
        baseline5kSeconds = 1590,
        frequencyDays = 4,
        preferredDays = ['Tue', 'Thu', 'Sat', 'Sun'],
        planWeeks = 12,
        units = 'km'
      } = userProfile;

      const basePaceSecPerKm = Math.round(baseline5kSeconds / 5.0);
      const zones = PaceEngine.calculateZones(basePaceSecPerKm);

      const easyPaceStr = PaceEngine.formatPaceString(zones[0].minSec, zones[0].maxSec, units);
      const tempoPaceStr = PaceEngine.formatPaceString(zones[2].minSec, zones[2].maxSec, units);
      const intervalPaceStr = PaceEngine.formatPaceString(zones[3].minSec, zones[3].maxSec, units);
      const speedPaceStr = PaceEngine.formatPaceString(zones[4].minSec, zones[4].maxSec, units);
      const longPaceStr = PaceEngine.formatPaceString(zones[0].minSec + 10, zones[0].maxSec + 20, units);

      const weeks = [];
      const totalWeeks = parseInt(planWeeks, 10) || 12;

      // Base volume scaling depending on goal
      let startingLongRunKm = 7;
      let peakLongRunKm = 14;
      if (goalDistance === '5k') {
        startingLongRunKm = 5;
        peakLongRunKm = 8;
      } else if (goalDistance === 'half') {
        startingLongRunKm = 10;
        peakLongRunKm = 18;
      } else if (goalDistance === 'marathon') {
        startingLongRunKm = 16;
        peakLongRunKm = 32;
      }

      for (let w = 1; w <= totalWeeks; w++) {
        // Determine phase
        let phase = 'Base Building';
        let isCutbackWeek = (w % 4 === 0 && w < totalWeeks - 1);
        let isTaperWeek = (w === totalWeeks);

        if (w <= Math.floor(totalWeeks * 0.33)) {
          phase = 'Aerobic Base Phase';
        } else if (w <= Math.floor(totalWeeks * 0.75)) {
          phase = 'Threshold & Speed Build';
        } else if (w < totalWeeks) {
          phase = 'Peak Specificity Phase';
        } else {
          phase = 'Taper & Race Week';
        }

        // Long run calculation for this week
        let weekLongKm = Math.round(startingLongRunKm + (peakLongRunKm - startingLongRunKm) * ((w - 1) / Math.max(1, totalWeeks - 2)));
        if (isCutbackWeek) weekLongKm = Math.max(startingLongRunKm, Math.round(weekLongKm * 0.8));
        if (isTaperWeek) weekLongKm = (goalDistance === '5k') ? 5 : (goalDistance === '10k') ? 10 : (goalDistance === 'half') ? 21.1 : 42.2;

        // Generate the 7 days of the week
        const days = [];
        let runningDaysAssigned = 0;
        let weekTotalDistance = 0;

        // Map which workouts go to running days
        const runRoles = ['intervals', 'easy', 'tempo', 'long', 'easy'];

        DAYS_ORDER.forEach((dayName) => {
          const isSelectedRunningDay = preferredDays.includes(dayName);

          if (isSelectedRunningDay && runningDaysAssigned < frequencyDays) {
            const role = runRoles[runningDaysAssigned] || 'easy';
            runningDaysAssigned++;

            let workout = null;

            if (role === 'intervals') {
              const repCount = Math.min(10, 4 + Math.floor(w * 0.6));
              const dist = 6.0 + Math.round((w * 0.2) * 10) / 10;
              weekTotalDistance += dist;

              workout = {
                id: `w${w}-${dayName}`,
                day: dayName,
                type: 'intervals',
                title: `${repCount} x 400m VO2 Max Repeats`,
                badge: 'INTERVALS',
                distance: `${dist} km`,
                distanceValue: dist,
                duration: `${35 + Math.round(repCount * 2.5)} min`,
                targetPace: intervalPaceStr,
                description: `High-intensity interval repetition session to elevate VO2 max and running efficiency.`,
                steps: [
                  {
                    title: 'Warm-up & Activation',
                    pace: easyPaceStr,
                    desc: '1.5 km easy aerobic jog, followed by 3x 50m leg swings, high knees, and glute bridges.'
                  },
                  {
                    title: `Main Working Sets: ${repCount} Reps`,
                    pace: intervalPaceStr,
                    desc: `${repCount} x 400m fast repeats at target 5K pace, with 90 seconds walking or slow recovery jog between each repeat.`
                  },
                  {
                    title: 'Cool-down & Stretch',
                    pace: easyPaceStr,
                    desc: '1.0 km very easy jog, followed by quad, calf, and hamstring static stretches.'
                  },
                  {
                    title: 'Coach Tip',
                    pace: 'Focus: Cadence',
                    desc: 'Aim for a quick 175-185 steps/min cadence. Keep your shoulders relaxed and arms driving forward.'
                  }
                ]
              };
            } else if (role === 'tempo') {
              const tempoMins = 18 + Math.floor(w * 1.5);
              const dist = 7.0 + Math.round((tempoMins * 0.18) * 10) / 10;
              weekTotalDistance += dist;

              workout = {
                id: `w${w}-${dayName}`,
                day: dayName,
                type: 'tempo',
                title: `${tempoMins} Min Lactate Threshold Tempo`,
                badge: 'TEMPO',
                distance: `${dist} km`,
                distanceValue: dist,
                duration: `${30 + tempoMins} min`,
                targetPace: tempoPaceStr,
                description: `Sustained threshold run at 'comfortably hard' pace to push back your anaerobic fatigue barrier.`,
                steps: [
                  {
                    title: 'Warm-up',
                    pace: easyPaceStr,
                    desc: '1.5 km easy aerobic jog to loosen up and prepare muscles.'
                  },
                  {
                    title: `Continuous Tempo Block (${tempoMins} mins)`,
                    pace: tempoPaceStr,
                    desc: `Hold a steady, locked-in threshold pace for the full ${tempoMins} minutes without surging.`
                  },
                  {
                    title: 'Cool-down',
                    pace: easyPaceStr,
                    desc: '1.0 km light jog and deep recovery breathing.'
                  },
                  {
                    title: 'Coach Tip',
                    pace: 'Breathing: 2-2 Rhythm',
                    desc: 'Maintain a 2 steps in, 2 steps out breathing pattern. If you cannot speak 3 words, dial pace back slightly.'
                  }
                ]
              };
            } else if (role === 'long') {
              const dist = weekLongKm;
              weekTotalDistance += dist;

              if (isTaperWeek) {
                workout = {
                  id: `w${w}-${dayName}`,
                  day: dayName,
                  type: 'long',
                  title: `🏆 RACE DAY: ${goalDistance.toUpperCase()}`,
                  badge: 'RACE DAY',
                  distance: `${dist} km`,
                  distanceValue: dist,
                  duration: 'All-out',
                  targetPace: intervalPaceStr,
                  description: `Trust your training! Run controlled for the first half, then negative split the second half.`,
                  steps: [
                    {
                      title: 'Pre-Race Warm-up',
                      pace: easyPaceStr,
                      desc: '10-12 min easy jog, 3x 50m accelerations, and dynamic hip openers.'
                    },
                    {
                      title: 'Official Race Distance',
                      pace: intervalPaceStr,
                      desc: `Give your best effort over ${dist} km. Execute hydration every 4-5 km.`
                    },
                    {
                      title: 'Post-Race Celebration',
                      pace: 'Walk',
                      desc: 'Celebrate your achievement! Rehydrate with electrolytes and enjoy a recovery protein meal.'
                    }
                  ]
                };
              } else {
                workout = {
                  id: `w${w}-${dayName}`,
                  day: dayName,
                  type: 'long',
                  title: `${dist} km Progressive Long Run`,
                  badge: 'LONG RUN',
                  distance: `${dist} km`,
                  distanceValue: dist,
                  duration: `~${Math.round(dist * 6)} min`,
                  targetPace: longPaceStr,
                  description: `The cornerstone session of the week. Builds cardiovascular endurance, mitochondrial density, and mental grit.`,
                  steps: [
                    {
                      title: 'First Half: Easy & Controlled',
                      pace: longPaceStr,
                      desc: `Run the first ${Math.round(dist * 0.6)} km strictly at conversational aerobic effort.`
                    },
                    {
                      title: 'Second Half: Steady Finish',
                      pace: easyPaceStr,
                      desc: `Pick up the effort slightly for the final ${Math.round(dist * 0.4)} km to simulate late-race fatigue.`
                    },
                    {
                      title: 'Post-Run Nutrition',
                      pace: 'Recovery',
                      desc: 'Drink 500ml electrolytes and consume 25g protein within 30 minutes.'
                    }
                  ]
                };
              }
            } else {
              // Easy run
              const dist = Math.round((5.0 + (w * 0.3)) * 10) / 10;
              weekTotalDistance += dist;

              workout = {
                id: `w${w}-${dayName}`,
                day: dayName,
                type: 'easy',
                title: `${dist} km Recovery & Aerobic Run`,
                badge: 'EASY RUN',
                distance: `${dist} km`,
                distanceValue: dist,
                duration: `~${Math.round(dist * 6)} min`,
                targetPace: easyPaceStr,
                description: `Low-stress aerobic recovery session designed to flush out lactate and build mileage base safely.`,
                steps: [
                  {
                    title: 'Full Distance: Continuous Easy Effort',
                    pace: easyPaceStr,
                    desc: `Keep this strictly conversational. You should be able to speak in full complete sentences throughout.`
                  },
                  {
                    title: 'Mobility & Foam Rolling',
                    pace: 'Post-Run',
                    desc: 'Spend 5-8 minutes foam rolling calves, IT bands, and hips.'
                  }
                ]
              };
            }

            days.push(workout);
          } else {
            // Rest or mobility day
            days.push({
              id: `w${w}-${dayName}`,
              day: dayName,
              type: 'rest',
              title: (dayName === 'Wed' || dayName === 'Fri') ? 'Active Recovery & Core Mobility' : 'Complete Rest & Rebuild',
              badge: 'REST DAY',
              distance: '0 km',
              distanceValue: 0,
              duration: '30 min',
              targetPace: 'Rest',
              description: (dayName === 'Wed' || dayName === 'Fri')
                ? 'Optional 20-min session: planks, glute bridges, bird-dogs, and hamstring stretching.'
                : 'Sleep at least 8 hours, hydrate, and allow muscles and tendons to adapt.',
              steps: [
                {
                  title: 'Recovery Focus',
                  pace: 'Zero Impact',
                  desc: 'Muscles grow and aerobic adaptations occur when you rest. Prioritize sleep quality and healthy nutrition.'
                }
              ]
            });
          }
        });

        weeks.push({
          weekNumber: w,
          phase: phase,
          isCutback: isCutbackWeek,
          isTaper: isTaperWeek,
          totalDistanceKm: Math.round(weekTotalDistance * 10) / 10,
          days: days
        });
      }

      const planName = goalDistance === '5k' ? '5K Fast Track'
        : goalDistance === '10k' ? '10K Personal Record'
        : goalDistance === 'half' ? 'Half Marathon Finisher'
        : goalDistance === 'marathon' ? 'Marathon Milestone'
        : 'Runna Fitness Accelerator';

      return {
        id: 'plan_' + Date.now(),
        name: planName,
        goalDistance: goalDistance,
        goalAmbition: userProfile.goalAmbition || 'finish',
        totalWeeks: totalWeeks,
        frequencyDays: frequencyDays,
        preferredDays: preferredDays,
        baseline5kSeconds: baseline5kSeconds,
        units: units,
        createdAt: new Date().toISOString(),
        weeks: weeks
      };
    }
  };

  /* ==========================================================================
     5. BACKEND ADAPTER: FIREBASE + LOCALSTORAGE FALLBACK
     ========================================================================== */

  const BackendAdapter = {
    init() {
      // 1. Try to load saved Firebase Config from localStorage
      const savedConfigStr = localStorage.getItem(STORAGE_KEYS.FIREBASE_CONFIG);
      if (savedConfigStr && window.firebase) {
        try {
          const config = JSON.parse(savedConfigStr);
          if (config.apiKey && config.projectId) {
            if (!firebase.apps.length) {
              STATE.firebaseApp = firebase.initializeApp(config);
            } else {
              STATE.firebaseApp = firebase.app();
            }
            STATE.firebaseAuth = firebase.auth();
            STATE.firestoreDb = firebase.firestore();
            STATE.isFirebaseLive = true;
            this.updateCloudStatusBadge(true);
            this.bindFirebaseAuth();
            return;
          }
        } catch (err) {
          console.warn('Firebase config error, falling back to local mode:', err);
        }
      }

      // Fallback: LocalStorage Multi-User Mode
      STATE.isFirebaseLive = false;
      this.updateCloudStatusBadge(false);
      this.initLocalAuth();
    },

    updateCloudStatusBadge(isLive) {
      const badge = document.getElementById('cloud-status-badge');
      const text = document.getElementById('firebase-connection-text');
      if (isLive) {
        badge.textContent = '● Firebase Live';
        badge.className = 'config-badge live';
        if (text) text.textContent = 'Connected (Firebase Auth & Firestore Cloud Sync Active)';
      } else {
        badge.textContent = '● Local Storage';
        badge.className = 'config-badge';
        if (text) text.textContent = 'Active (Local Multi-User & Demo Engine)';
      }
    },

    bindFirebaseAuth() {
      STATE.firebaseAuth.onAuthStateChanged(async (user) => {
        if (user) {
          // Fetch user profile doc from Firestore
          try {
            const doc = await STATE.firestoreDb.collection('users').doc(user.uid).get();
            let profileData = doc.exists ? doc.data() : {};
            STATE.currentUser = {
              uid: user.uid,
              email: user.email,
              displayName: profileData.displayName || user.displayName || user.email.split('@')[0],
              units: profileData.units || 'km',
              baseline5kSeconds: profileData.baseline5kSeconds || 1590,
              goalDistance: profileData.goalDistance || '10k',
              goalAmbition: profileData.goalAmbition || 'improve',
              frequencyDays: profileData.frequencyDays || 4,
              preferredDays: profileData.preferredDays || ['Tue', 'Thu', 'Sat', 'Sun'],
              planWeeks: profileData.planWeeks || 12,
              completedWorkouts: profileData.completedWorkouts || {}
            };

            // Fetch active plan
            const planDoc = await STATE.firestoreDb.collection('plans').doc(user.uid).get();
            if (planDoc.exists) {
              STATE.activePlan = planDoc.data();
            } else {
              // Generate first plan
              STATE.activePlan = PlanGenerator.generatePlan(STATE.currentUser);
              await STATE.firestoreDb.collection('plans').doc(user.uid).set(STATE.activePlan);
            }
          } catch (e) {
            console.error('Firestore sync error:', e);
          }
          AppUI.onUserAuthenticated();
        } else {
          STATE.currentUser = null;
          STATE.activePlan = null;
          AppUI.onUserLoggedOut();
        }
      });
    },

    initLocalAuth() {
      // Check if an active user ID exists in LocalStorage
      const activeId = localStorage.getItem(STORAGE_KEYS.ACTIVE_USER_ID);
      const users = this.getLocalUsers();

      if (activeId && users[activeId]) {
        STATE.currentUser = users[activeId];
        const savedPlan = localStorage.getItem(STORAGE_KEYS.USER_PLANS_PREFIX + activeId);
        if (savedPlan) {
          try {
            STATE.activePlan = JSON.parse(savedPlan);
          } catch (e) {
            STATE.activePlan = PlanGenerator.generatePlan(STATE.currentUser);
          }
        } else {
          STATE.activePlan = PlanGenerator.generatePlan(STATE.currentUser);
          localStorage.setItem(STORAGE_KEYS.USER_PLANS_PREFIX + activeId, JSON.stringify(STATE.activePlan));
        }
        AppUI.onUserAuthenticated();
      } else {
        // Automatically log in Demo Runner on first load for a frictionless initial impression
        this.loginDemoUser();
      }
    },

    getLocalUsers() {
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_USERS);
        return raw ? JSON.parse(raw) : {};
      } catch (e) {
        return {};
      }
    },

    saveLocalUsers(users) {
      localStorage.setItem(STORAGE_KEYS.LOCAL_USERS, JSON.stringify(users));
    },

    async register(name, email, password) {
      if (STATE.isFirebaseLive) {
        const cred = await STATE.firebaseAuth.createUserWithEmailAndPassword(email, password);
        await cred.user.updateProfile({ displayName: name });
        const defaultProfile = {
          ...DEMO_USER,
          uid: cred.user.uid,
          displayName: name,
          email: email
        };
        await STATE.firestoreDb.collection('users').doc(cred.user.uid).set(defaultProfile);
        const plan = PlanGenerator.generatePlan(defaultProfile);
        await STATE.firestoreDb.collection('plans').doc(cred.user.uid).set(plan);
        return cred.user;
      } else {
        const users = this.getLocalUsers();
        if (users[email]) {
          throw new Error('An account with this email already exists.');
        }
        const newUser = {
          ...DEMO_USER,
          uid: 'user_' + Date.now(),
          displayName: name || email.split('@')[0],
          email: email,
          password: password,
          completedWorkouts: {}
        };
        users[email] = newUser;
        this.saveLocalUsers(users);

        localStorage.setItem(STORAGE_KEYS.ACTIVE_USER_ID, email);
        STATE.currentUser = newUser;
        STATE.activePlan = PlanGenerator.generatePlan(newUser);
        localStorage.setItem(STORAGE_KEYS.USER_PLANS_PREFIX + email, JSON.stringify(STATE.activePlan));
        AppUI.onUserAuthenticated();
        return newUser;
      }
    },

    async login(email, password) {
      if (STATE.isFirebaseLive) {
        return await STATE.firebaseAuth.signInWithEmailAndPassword(email, password);
      } else {
        const users = this.getLocalUsers();
        const user = users[email];
        if (!user || user.password !== password) {
          throw new Error('Invalid email or password. Try demo login or sign up!');
        }
        localStorage.setItem(STORAGE_KEYS.ACTIVE_USER_ID, email);
        STATE.currentUser = user;
        const savedPlan = localStorage.getItem(STORAGE_KEYS.USER_PLANS_PREFIX + email);
        if (savedPlan) {
          STATE.activePlan = JSON.parse(savedPlan);
        } else {
          STATE.activePlan = PlanGenerator.generatePlan(user);
          localStorage.setItem(STORAGE_KEYS.USER_PLANS_PREFIX + email, JSON.stringify(STATE.activePlan));
        }
        AppUI.onUserAuthenticated();
        return user;
      }
    },

    loginDemoUser() {
      const users = this.getLocalUsers();
      if (!users[DEMO_USER.email]) {
        users[DEMO_USER.email] = { ...DEMO_USER };
        this.saveLocalUsers(users);
      }
      localStorage.setItem(STORAGE_KEYS.ACTIVE_USER_ID, DEMO_USER.email);
      STATE.currentUser = users[DEMO_USER.email];
      
      const savedPlan = localStorage.getItem(STORAGE_KEYS.USER_PLANS_PREFIX + DEMO_USER.email);
      if (savedPlan) {
        try {
          STATE.activePlan = JSON.parse(savedPlan);
        } catch (e) {
          STATE.activePlan = PlanGenerator.generatePlan(STATE.currentUser);
        }
      } else {
        STATE.activePlan = PlanGenerator.generatePlan(STATE.currentUser);
        localStorage.setItem(STORAGE_KEYS.USER_PLANS_PREFIX + DEMO_USER.email, JSON.stringify(STATE.activePlan));
      }

      AppUI.onUserAuthenticated();
    },

    async logout() {
      if (STATE.isFirebaseLive) {
        await STATE.firebaseAuth.signOut();
      } else {
        localStorage.removeItem(STORAGE_KEYS.ACTIVE_USER_ID);
        STATE.currentUser = null;
        STATE.activePlan = null;
        AppUI.onUserLoggedOut();
      }
    },

    async saveUserData(userData, planData) {
      if (!STATE.currentUser) return;
      STATE.currentUser = { ...STATE.currentUser, ...userData };
      if (planData) STATE.activePlan = planData;

      if (STATE.isFirebaseLive) {
        const uid = STATE.currentUser.uid;
        await STATE.firestoreDb.collection('users').doc(uid).set(STATE.currentUser, { merge: true });
        if (planData) {
          await STATE.firestoreDb.collection('plans').doc(uid).set(planData);
        }
      } else {
        const users = this.getLocalUsers();
        users[STATE.currentUser.email] = STATE.currentUser;
        this.saveLocalUsers(users);
        if (planData) {
          localStorage.setItem(STORAGE_KEYS.USER_PLANS_PREFIX + STATE.currentUser.email, JSON.stringify(planData));
        }
      }
    },

    async toggleWorkoutCompletion(workoutId) {
      if (!STATE.currentUser) return;
      const completed = STATE.currentUser.completedWorkouts || {};
      if (completed[workoutId]) {
        delete completed[workoutId];
      } else {
        completed[workoutId] = {
          completedAt: new Date().toISOString()
        };
      }
      STATE.currentUser.completedWorkouts = completed;
      await this.saveUserData({ completedWorkouts: completed });
      AppUI.renderDashboard();
    }
  };

  /* ==========================================================================
     6. UI CONTROLLER & VIEW ROUTING
     ========================================================================== */

  const AppUI = {
    currentTab: 'dashboard',
    authMode: 'login',

    init() {
      this.bindEvents();
      BackendAdapter.init();
      this.initCalculator();
      this.initPaceZonesTable();
    },

    showToast(message, type = 'volt') {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
        <span>${message}</span>
      `;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 250);
      }, 3200);
    },

    switchView(viewName) {
      this.currentTab = viewName;

      // Update navbar links active states
      document.querySelectorAll('[data-nav]').forEach(el => {
        if (el.dataset.nav === viewName) {
          el.classList.add('active');
        } else {
          el.classList.remove('active');
        }
      });

      // Show the selected section
      document.querySelectorAll('.view-section').forEach(sec => {
        sec.classList.remove('active');
      });

      const target = document.getElementById(`view-${viewName}`);
      if (target) {
        target.classList.add('active');
      }

      if (viewName === 'dashboard') {
        this.renderDashboard();
      } else if (viewName === 'profile') {
        this.renderProfile();
      } else if (viewName === 'tools') {
        this.updatePaceCalculator();
      }
    },

    onUserAuthenticated() {
      this.renderNavUserPill();
      this.switchView('dashboard');
      this.showToast(`Welcome back, ${STATE.currentUser.displayName}!`, 'success');
    },

    onUserLoggedOut() {
      this.renderNavUserPill();
      this.switchView('auth');
      this.showToast('Signed out successfully.', 'volt');
    },

    renderNavUserPill() {
      const container = document.getElementById('auth-header-container');
      if (!container) return;

      if (STATE.currentUser) {
        const initial = (STATE.currentUser.displayName || 'R').charAt(0).toUpperCase();
        container.innerHTML = `
          <div class="user-pill" style="cursor: pointer;" id="nav-user-pill">
            <div class="user-avatar">${initial}</div>
            <span style="display: none; @media(min-width: 600px){ display: inline; }">${STATE.currentUser.displayName.split(' ')[0]}</span>
          </div>
        `;
        document.getElementById('nav-user-pill').addEventListener('click', () => {
          this.switchView('profile');
        });
      } else {
        container.innerHTML = `
          <button id="nav-signin-btn" class="btn btn-primary btn-sm">Sign In</button>
        `;
        document.getElementById('nav-signin-btn').addEventListener('click', () => {
          this.switchView('auth');
        });
      }
    },

    /* --------------------------------------------------
       DASHBOARD RENDERING & WEEK SELECTOR
       -------------------------------------------------- */
    renderDashboard() {
      if (!STATE.currentUser || !STATE.activePlan) {
        return;
      }

      const plan = STATE.activePlan;
      const totalWeeks = plan.weeks ? plan.weeks.length : 12;

      if (STATE.currentWeekIndex >= totalWeeks) {
        STATE.currentWeekIndex = 0;
      }
      const currentWeekData = plan.weeks[STATE.currentWeekIndex];

      // Update hero stat cards
      document.getElementById('stat-plan-name').textContent = plan.name;
      document.getElementById('stat-plan-desc').textContent = `${plan.totalWeeks} Weeks • ${plan.frequencyDays} Days / Wk`;

      const unitLabel = (STATE.currentUser.units || 'km');
      const weekKm = currentWeekData ? currentWeekData.totalDistanceKm : 25;
      const displayDistance = (unitLabel === 'mi') ? (weekKm * 0.621371).toFixed(1) : weekKm.toFixed(1);
      document.getElementById('stat-week-mileage').innerHTML = `${displayDistance} <span style="font-size: 1rem; color: var(--text-muted);">${unitLabel}</span>`;

      document.getElementById('stat-week-phase').textContent = `${currentWeekData.phase} (Week ${STATE.currentWeekIndex + 1} of ${totalWeeks})`;

      // Calculate completed workouts
      const completedMap = STATE.currentUser.completedWorkouts || {};
      let totalAssignedWorkouts = 0;
      let totalCompletedCount = 0;

      plan.weeks.forEach(w => {
        w.days.forEach(d => {
          if (d.type !== 'rest') {
            totalAssignedWorkouts++;
            if (completedMap[d.id]) {
              totalCompletedCount++;
            }
          }
        });
      });

      const pct = totalAssignedWorkouts > 0 ? Math.round((totalCompletedCount / totalAssignedWorkouts) * 100) : 0;
      document.getElementById('stat-completed-rate').textContent = `${totalCompletedCount} / ${totalAssignedWorkouts}`;
      document.getElementById('stat-streak').textContent = `🔥 ${pct}% Plan Completed`;

      // Pace benchmark display
      const baseSec = STATE.currentUser.baseline5kSeconds || 1590;
      const basePerKm = Math.round(baseSec / 5.0);
      const paceVal = (unitLabel === 'mi') ? PaceEngine.formatTime(PaceEngine.kmToMiPace(basePerKm)) : PaceEngine.formatTime(basePerKm);
      document.getElementById('stat-race-pace').innerHTML = `${paceVal} <span style="font-size: 1rem; color: var(--text-muted);">/${unitLabel}</span>`;

      const est10kSec = Math.round(baseSec * 2.08);
      document.getElementById('stat-pred-time').textContent = `Est. 10K: ${PaceEngine.formatTime(est10kSec)}`;

      // Week title heading
      document.getElementById('current-week-heading').textContent = `Week ${STATE.currentWeekIndex + 1}: ${currentWeekData.phase}`;
      document.getElementById('current-week-subtitle').textContent = currentWeekData.isCutback
        ? 'Recovery Cutback Week: 20% reduced volume to absorb training adaptations.'
        : currentWeekData.isTaper
        ? 'Taper & Race: Fresh legs, sharp mind, race day execution.'
        : 'Progressive overload with balanced intervals, tempo thresholds, and long run endurance.';

      // Render week selector pills
      const pillsContainer = document.getElementById('week-pills-container');
      pillsContainer.innerHTML = '';
      plan.weeks.forEach((w, idx) => {
        const btn = document.createElement('button');
        btn.className = `week-nav-btn ${idx === STATE.currentWeekIndex ? 'active' : ''}`;
        btn.textContent = `W${w.weekNumber}`;
        btn.addEventListener('click', () => {
          STATE.currentWeekIndex = idx;
          this.renderDashboard();
        });
        pillsContainer.appendChild(btn);
      });

      // Render day workout cards
      const cardsGrid = document.getElementById('schedule-cards-grid');
      cardsGrid.innerHTML = '';

      currentWeekData.days.forEach(workout => {
        const isDone = !!completedMap[workout.id];
        const card = document.createElement('div');
        card.className = `workout-card type-${workout.type} ${isDone ? 'is-completed' : ''}`;

        const badgeClass = workout.type === 'intervals' ? 'badge-intervals'
          : workout.type === 'tempo' ? 'badge-tempo'
          : workout.type === 'long' ? 'badge-long'
          : workout.type === 'easy' ? 'badge-easy' : 'badge-rest';

        card.innerHTML = `
          <div>
            <div class="workout-card-top">
              <span class="day-badge">${workout.day}</span>
              <span class="badge ${badgeClass}">${workout.badge}</span>
            </div>
            <h3 class="workout-title">${workout.title}</h3>
            <p class="workout-desc">${workout.description}</p>
          </div>

          <div>
            <div class="workout-metrics">
              <div class="metric-item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                <span>${workout.duration}</span>
              </div>
              <div class="metric-item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg>
                <span>${workout.targetPace}</span>
              </div>
            </div>

            <div class="workout-card-actions">
              ${workout.type !== 'rest' ? `
                <button class="check-complete-btn" data-complete-id="${workout.id}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  <span>${isDone ? 'Completed' : 'Mark Done'}</span>
                </button>
              ` : `<span></span>`}

              <button class="btn btn-secondary btn-sm open-detail-btn" data-workout-id="${workout.id}">
                Details
              </button>
            </div>
          </div>
        `;

        card.querySelector('.open-detail-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          this.openWorkoutModal(workout);
        });

        const completeBtn = card.querySelector('[data-complete-id]');
        if (completeBtn) {
          completeBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await BackendAdapter.toggleWorkoutCompletion(workout.id);
            audioEngine.beepWarning();
            AppUI.showToast(isDone ? 'Marked workout incomplete' : 'Workout completed! Great effort! 🏃', 'success');
          });
        }

        card.addEventListener('click', () => {
          this.openWorkoutModal(workout);
        });

        cardsGrid.appendChild(card);
      });
    },

    /* --------------------------------------------------
       WORKOUT DETAIL MODAL
       -------------------------------------------------- */
    openWorkoutModal(workout) {
      STATE.selectedWorkout = workout;
      const modal = document.getElementById('workout-modal');
      const completedMap = (STATE.currentUser && STATE.currentUser.completedWorkouts) || {};
      const isDone = !!completedMap[workout.id];

      document.getElementById('modal-workout-badge').textContent = workout.badge;
      document.getElementById('modal-workout-title').textContent = workout.title;
      document.getElementById('modal-workout-distance').textContent = workout.distance;
      document.getElementById('modal-workout-duration').textContent = workout.duration;
      document.getElementById('modal-workout-desc').textContent = workout.description;

      const stepsContainer = document.getElementById('modal-workout-steps');
      stepsContainer.innerHTML = '';

      if (workout.steps && workout.steps.length > 0) {
        workout.steps.forEach((step, idx) => {
          const stepCard = document.createElement('div');
          const stepTypeClass = idx === 0 ? 'step-warmup' : (idx === workout.steps.length - 1 ? 'step-cooldown' : 'step-main');
          stepCard.className = `step-card ${stepTypeClass}`;
          stepCard.innerHTML = `
            <div class="step-title">
              <span>${step.title}</span>
              <span class="step-pace">${step.pace}</span>
            </div>
            <div class="step-desc">${step.desc}</div>
          `;
          stepsContainer.appendChild(stepCard);
        });
      }

      const completeBtn = document.getElementById('modal-toggle-complete-btn');
      completeBtn.textContent = isDone ? '✓ Completed (Click to Undo)' : 'Mark Workout Completed';
      completeBtn.onclick = async () => {
        await BackendAdapter.toggleWorkoutCompletion(workout.id);
        this.closeModals();
        audioEngine.beepWarning();
      };

      const startTimerBtn = document.getElementById('modal-start-timer-btn');
      startTimerBtn.onclick = () => {
        this.closeModals();
        this.loadWorkoutIntoTimer(workout);
        this.switchView('tools');
      };

      modal.classList.add('active');
    },

    closeModals() {
      document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
    },

    /* --------------------------------------------------
       LIVE PACER & INTERVAL TIMER
       -------------------------------------------------- */
    loadWorkoutIntoTimer(workout) {
      const steps = [];
      if (workout.steps && workout.steps.length > 0) {
        workout.steps.forEach((st) => {
          let duration = 300;
          if (st.title.toLowerCase().includes('warm')) duration = 480;
          else if (st.title.toLowerCase().includes('cool')) duration = 300;
          else if (st.title.toLowerCase().includes('tempo')) duration = 1200;
          else if (st.title.toLowerCase().includes('reps') || st.title.toLowerCase().includes('repeats')) duration = 90;

          steps.push({
            title: st.title,
            pace: st.pace,
            duration: duration,
            desc: st.desc
          });
        });
      }

      if (steps.length === 0) {
        steps.push({ title: workout.title, pace: workout.targetPace, duration: 1800, desc: workout.description });
      }

      STATE.timer.steps = steps;
      STATE.timer.currentStepIndex = 0;
      STATE.timer.elapsedSeconds = 0;
      this.resetTimer();
      this.updateTimerDisplay();
    },

    updateTimerDisplay() {
      const { steps, currentStepIndex, elapsedSeconds } = STATE.timer;
      const currentStep = steps[currentStepIndex] || {
        title: 'Free Stopwatch Run',
        pace: 'Run your pace',
        duration: 0
      };

      document.getElementById('timer-step-tag').textContent = `STAGE ${currentStepIndex + 1} OF ${Math.max(1, steps.length)}`;
      document.getElementById('timer-step-title').textContent = currentStep.title;
      document.getElementById('timer-step-pace').textContent = `Target Pace: ${currentStep.pace}`;

      const m = Math.floor(elapsedSeconds / 60);
      const s = Math.floor(elapsedSeconds % 60);
      document.getElementById('timer-digits').textContent = `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    },

    toggleTimer() {
      if (STATE.timer.isRunning) {
        this.pauseTimer();
      } else {
        this.startTimer();
      }
    },

    startTimer() {
      audioEngine.init();
      audioEngine.chimeStepStart();

      STATE.timer.isRunning = true;
      document.getElementById('timer-btn-label').textContent = 'Pause';
      document.getElementById('timer-play-icon').innerHTML = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';

      clearInterval(STATE.timer.intervalId);
      STATE.timer.intervalId = setInterval(() => {
        STATE.timer.elapsedSeconds++;

        const curStep = STATE.timer.steps[STATE.timer.currentStepIndex];
        if (curStep && curStep.duration) {
          const remaining = curStep.duration - STATE.timer.elapsedSeconds;
          if (remaining > 0 && remaining <= 3) {
            audioEngine.beepWarning();
          } else if (remaining === 0) {
            this.skipTimerStep();
            return;
          }
        }

        this.updateTimerDisplay();
      }, 1000);
    },

    pauseTimer() {
      STATE.timer.isRunning = false;
      clearInterval(STATE.timer.intervalId);
      document.getElementById('timer-btn-label').textContent = 'Resume';
      document.getElementById('timer-play-icon').innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';
    },

    resetTimer() {
      this.pauseTimer();
      STATE.timer.elapsedSeconds = 0;
      document.getElementById('timer-btn-label').textContent = 'Start Workout';
      this.updateTimerDisplay();
    },

    skipTimerStep() {
      if (STATE.timer.steps.length === 0) return;
      if (STATE.timer.currentStepIndex < STATE.timer.steps.length - 1) {
        STATE.timer.currentStepIndex++;
        STATE.timer.elapsedSeconds = 0;
        audioEngine.chimeStepStart();
        this.updateTimerDisplay();
        this.showToast(`Next stage: ${STATE.timer.steps[STATE.timer.currentStepIndex].title}`, 'volt');
      } else {
        this.pauseTimer();
        audioEngine.chimeCompleted();
        this.showToast('Workout finished! Outstanding session! 🎉', 'success');
      }
    },

    /* --------------------------------------------------
       PACE CALCULATOR & TRAINING ZONES
       -------------------------------------------------- */
    initCalculator() {
      const distSelect = document.getElementById('calc-distance-select');
      const hInput = document.getElementById('calc-time-h');
      const mInput = document.getElementById('calc-time-m');
      const sInput = document.getElementById('calc-time-s');

      const recalculate = () => {
        const distKm = parseFloat(distSelect.value) || 10;
        const h = parseInt(hInput.value, 10) || 0;
        const m = parseInt(mInput.value, 10) || 0;
        const s = parseInt(sInput.value, 10) || 0;
        const totalSec = h * 3600 + m * 60 + s;

        if (totalSec > 0 && distKm > 0) {
          const secPerKm = totalSec / distKm;
          const secPerMi = secPerKm * 1.60934;
          const kmh = (distKm / (totalSec / 3600)).toFixed(1);
          const mph = ((distKm * 0.621371) / (totalSec / 3600)).toFixed(1);

          document.getElementById('calc-pace-display').textContent = `${PaceEngine.formatTime(secPerKm)} /km`;
          document.getElementById('calc-imperial-display').textContent = `${PaceEngine.formatTime(secPerMi)} /mi (${kmh} km/h • ${mph} mph)`;
        }
      };

      distSelect.addEventListener('change', recalculate);
      hInput.addEventListener('input', recalculate);
      mInput.addEventListener('input', recalculate);
      sInput.addEventListener('input', recalculate);
      recalculate();
    },

    updatePaceCalculator() {
      this.initPaceZonesTable();
    },

    initPaceZonesTable() {
      const tbody = document.getElementById('zones-table-body');
      if (!tbody) return;

      const baseSec = (STATE.currentUser && STATE.currentUser.baseline5kSeconds) ? STATE.currentUser.baseline5kSeconds : 1590;
      const basePerKm = Math.round(baseSec / 5.0);
      const units = (STATE.currentUser && STATE.currentUser.units) || 'km';
      const zones = PaceEngine.calculateZones(basePerKm);

      tbody.innerHTML = '';
      zones.forEach(z => {
        const tr = document.createElement('tr');
        const formattedPace = PaceEngine.formatPaceString(z.minSec, z.maxSec, units);
        tr.innerHTML = `
          <td>
            <span class="zone-dot" style="background: ${z.color};"></span>
            <strong>${z.name}</strong>
          </td>
          <td style="color: var(--text-secondary);">${z.effort}</td>
          <td style="text-align: right; font-family: var(--font-mono); font-weight: 700; color: var(--accent-volt);">${formattedPace}</td>
        `;
        tbody.appendChild(tr);
      });
    },

    /* --------------------------------------------------
       USER PROFILE TAB
       -------------------------------------------------- */
    renderProfile() {
      if (!STATE.currentUser) return;
      const user = STATE.currentUser;
      const initial = (user.displayName || 'R').charAt(0).toUpperCase();

      document.getElementById('profile-avatar-letter').textContent = initial;
      document.getElementById('profile-name-display').textContent = user.displayName;
      document.getElementById('profile-email-display').textContent = user.email;

      const goalLabel = user.goalDistance ? user.goalDistance.toUpperCase() : '10K';
      document.getElementById('prof-goal-val').textContent = `${goalLabel} Training`;
      document.getElementById('prof-5k-val').textContent = PaceEngine.formatTime(user.baseline5kSeconds || 1590);
      document.getElementById('prof-freq-val').textContent = `${user.frequencyDays || 4} Days / Week`;
      document.getElementById('prof-unit-val').textContent = user.units === 'mi' ? 'Imperial (Miles)' : 'Metric (Kilometers)';
    },

    /* --------------------------------------------------
       WIZARD / QUESTIONNAIRE LOGIC
       -------------------------------------------------- */
    initWizard() {
      let currentStep = 1;
      const totalSteps = 4;

      const updateWizardUI = () => {
        document.querySelectorAll('.wizard-bar').forEach(bar => {
          const s = parseInt(bar.dataset.step, 10);
          if (s <= currentStep) bar.classList.add('active');
          else bar.classList.remove('active');
        });

        document.querySelectorAll('.wizard-step').forEach((el, idx) => {
          if (idx + 1 === currentStep) el.classList.add('active');
          else el.classList.remove('active');
        });

        const prevBtn = document.getElementById('wizard-prev-btn');
        const nextBtn = document.getElementById('wizard-next-btn');

        prevBtn.style.display = currentStep > 1 ? 'block' : 'none';
        nextBtn.textContent = currentStep === totalSteps ? 'Generate My Runna Plan 🚀' : 'Continue';
      };

      const setupChoiceGroup = (containerId) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.querySelectorAll('.choice-card').forEach(card => {
          card.addEventListener('click', () => {
            container.querySelectorAll('.choice-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
          });
        });
      };

      setupChoiceGroup('goal-distance-selector');
      setupChoiceGroup('goal-ambition-selector');
      setupChoiceGroup('unit-selector');
      setupChoiceGroup('experience-selector');
      setupChoiceGroup('frequency-selector');
      setupChoiceGroup('duration-selector');

      const freqContainer = document.getElementById('frequency-selector');
      if (freqContainer) {
        freqContainer.querySelectorAll('.choice-card').forEach(card => {
          card.addEventListener('click', () => {
            const freq = parseInt(card.dataset.value, 10);
            document.getElementById('required-days-count').textContent = freq;
            this.enforceSelectedDaysCount(freq);
          });
        });
      }

      const daysContainer = document.getElementById('days-picker-container');
      if (daysContainer) {
        daysContainer.querySelectorAll('.day-chip').forEach(chip => {
          chip.addEventListener('click', () => {
            const activeFreq = parseInt(document.getElementById('required-days-count').textContent, 10) || 4;
            const currentlySelected = daysContainer.querySelectorAll('.day-chip.selected');

            if (chip.classList.contains('selected')) {
              if (currentlySelected.length > 1) {
                chip.classList.remove('selected');
              }
            } else {
              if (currentlySelected.length < activeFreq) {
                chip.classList.add('selected');
              } else {
                currentlySelected[0].classList.remove('selected');
                chip.classList.add('selected');
              }
            }
          });
        });
      }

      const minInput = document.getElementById('base-5k-min');
      const secInput = document.getElementById('base-5k-sec');
      const updateBaselineDisplay = () => {
        const m = parseInt(minInput.value, 10) || 25;
        const s = parseInt(secInput.value, 10) || 0;
        const total = m * 60 + s;
        const perKm = Math.round(total / 5.0);
        document.getElementById('calculated-baseline-display').textContent = `${PaceEngine.formatTime(perKm)} min/km (${PaceEngine.formatTime(PaceEngine.kmToMiPace(perKm))} min/mi)`;
      };
      if (minInput && secInput) {
        minInput.addEventListener('input', updateBaselineDisplay);
        secInput.addEventListener('input', updateBaselineDisplay);
        updateBaselineDisplay();
      }

      const nextBtn = document.getElementById('wizard-next-btn');
      const prevBtn = document.getElementById('wizard-prev-btn');

      nextBtn.addEventListener('click', async () => {
        if (currentStep < totalSteps) {
          currentStep++;
          updateWizardUI();
        } else {
          await this.finishWizardAndGenerate();
        }
      });

      prevBtn.addEventListener('click', () => {
        if (currentStep > 1) {
          currentStep--;
          updateWizardUI();
        }
      });

      updateWizardUI();
    },

    enforceSelectedDaysCount(targetCount) {
      const chips = Array.from(document.querySelectorAll('#days-picker-container .day-chip'));
      let selected = chips.filter(c => c.classList.contains('selected'));

      while (selected.length > targetCount) {
        const last = selected.pop();
        last.classList.remove('selected');
      }
      while (selected.length < targetCount) {
        const unselected = chips.find(c => !c.classList.contains('selected'));
        if (unselected) {
          unselected.classList.add('selected');
          selected.push(unselected);
        } else break;
      }
    },

    async finishWizardAndGenerate() {
      const goalCard = document.querySelector('#goal-distance-selector .choice-card.selected');
      const ambitionCard = document.querySelector('#goal-ambition-selector .choice-card.selected');
      const unitCard = document.querySelector('#unit-selector .choice-card.selected');
      const freqCard = document.querySelector('#frequency-selector .choice-card.selected');
      const durationCard = document.querySelector('#duration-selector .choice-card.selected');

      const min = parseInt(document.getElementById('base-5k-min').value, 10) || 26;
      const sec = parseInt(document.getElementById('base-5k-sec').value, 10) || 30;
      const baseline5kSeconds = min * 60 + sec;

      const selectedDays = Array.from(document.querySelectorAll('#days-picker-container .day-chip.selected'))
        .map(c => c.dataset.day);

      const profileUpdate = {
        goalDistance: goalCard ? goalCard.dataset.value : '10k',
        goalAmbition: ambitionCard ? ambitionCard.dataset.value : 'improve',
        units: unitCard ? unitCard.dataset.value : 'km',
        frequencyDays: freqCard ? parseInt(freqCard.dataset.value, 10) : 4,
        planWeeks: durationCard ? parseInt(durationCard.dataset.value, 10) : 12,
        baseline5kSeconds: baseline5kSeconds,
        preferredDays: selectedDays.length ? selectedDays : ['Tue', 'Thu', 'Sat', 'Sun']
      };

      const newPlan = PlanGenerator.generatePlan({
        ...(STATE.currentUser || DEMO_USER),
        ...profileUpdate
      });

      await BackendAdapter.saveUserData(profileUpdate, newPlan);
      STATE.currentWeekIndex = 0;
      this.switchView('dashboard');
      this.showToast('Your customized Runna plan has been generated!', 'success');
      audioEngine.chimeCompleted();
    },

    /* --------------------------------------------------
       EVENT LISTENERS & BINDINGS
       -------------------------------------------------- */
    bindEvents() {
      // Navigation buttons (desktop & mobile bottom nav)
      document.querySelectorAll('[data-nav]').forEach(el => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          this.switchView(el.dataset.nav);
        });
      });

      // Brand home button
      document.getElementById('brand-home-btn').addEventListener('click', (e) => {
        e.preventDefault();
        this.switchView('dashboard');
      });

      // Schedule week prev/next
      document.getElementById('prev-week-btn').addEventListener('click', () => {
        if (STATE.currentWeekIndex > 0) {
          STATE.currentWeekIndex--;
          this.renderDashboard();
        }
      });

      document.getElementById('next-week-btn').addEventListener('click', () => {
        const totalWeeks = (STATE.activePlan && STATE.activePlan.weeks) ? STATE.activePlan.weeks.length : 12;
        if (STATE.currentWeekIndex < totalWeeks - 1) {
          STATE.currentWeekIndex++;
          this.renderDashboard();
        }
      });

      // Re-plan / edit plan buttons
      document.getElementById('dash-replan-btn').addEventListener('click', () => {
        this.switchView('wizard');
      });
      document.getElementById('profile-edit-plan-btn').addEventListener('click', () => {
        this.switchView('wizard');
      });

      // Auth form submission
      const authForm = document.getElementById('auth-form');
      const submitBtn = document.getElementById('auth-submit-btn');
      const toggleModeBtn = document.getElementById('auth-toggle-mode');
      const quickDemoBtn = document.getElementById('quick-demo-btn');

      const setAuthBanner = (msg, isError = true) => {
        const banner = document.getElementById('auth-status-banner');
        banner.className = `auth-status-banner ${isError ? 'error' : 'success'}`;
        banner.textContent = msg;
      };

      toggleModeBtn.addEventListener('click', () => {
        this.authMode = this.authMode === 'login' ? 'signup' : 'login';
        document.getElementById('auth-title').textContent = this.authMode === 'login' ? 'Welcome to Runna' : 'Create Your Account';
        document.getElementById('auth-subtitle').textContent = this.authMode === 'login'
          ? 'Sign in to sync your personalized running coach & race plans'
          : 'Unlock adaptive training plans, pacing targets & analytics';
        document.getElementById('group-name').style.display = this.authMode === 'signup' ? 'block' : 'none';
        submitBtn.textContent = this.authMode === 'login' ? 'Sign In' : 'Sign Up';
        document.getElementById('auth-switch-text').textContent = this.authMode === 'login' ? "Don't have an account?" : 'Already have an account?';
        toggleModeBtn.textContent = this.authMode === 'login' ? 'Sign Up' : 'Sign In';
        document.getElementById('auth-status-banner').style.display = 'none';
      });

      submitBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = document.getElementById('auth-email').value.trim();
        const password = document.getElementById('auth-password').value;
        const name = document.getElementById('auth-name').value.trim();

        if (!email || !password) {
          setAuthBanner('Please enter both email and password.');
          return;
        }

        try {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Authenticating...';
          if (this.authMode === 'signup') {
            await BackendAdapter.register(name, email, password);
          } else {
            await BackendAdapter.login(email, password);
          }
        } catch (err) {
          setAuthBanner(err.message || 'Authentication error.');
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = this.authMode === 'login' ? 'Sign In' : 'Sign Up';
        }
      });

      quickDemoBtn.addEventListener('click', () => {
        BackendAdapter.loginDemoUser();
      });

      // Logout button in profile
      document.getElementById('profile-logout-btn').addEventListener('click', () => {
        BackendAdapter.logout();
      });

      // Live Timer Buttons
      document.getElementById('timer-start-pause-btn').addEventListener('click', () => {
        this.toggleTimer();
      });

      document.getElementById('timer-skip-btn').addEventListener('click', () => {
        this.skipTimerStep();
      });

      document.getElementById('timer-reset-btn').addEventListener('click', () => {
        this.resetTimer();
      });

      document.getElementById('timer-audio-toggle').addEventListener('change', (e) => {
        STATE.timer.soundEnabled = e.target.checked;
      });

      // Modal Close Buttons
      document.getElementById('modal-close-btn').addEventListener('click', () => {
        this.closeModals();
      });

      document.getElementById('workout-modal').addEventListener('click', (e) => {
        if (e.target.id === 'workout-modal') this.closeModals();
      });

      // Firebase Modal Open / Close / Save
      document.getElementById('open-firebase-modal-btn').addEventListener('click', () => {
        const saved = localStorage.getItem(STORAGE_KEYS.FIREBASE_CONFIG) || '';
        document.getElementById('firebase-config-input').value = saved;
        document.getElementById('firebase-modal').classList.add('active');
      });

      document.getElementById('firebase-modal-close').addEventListener('click', () => {
        document.getElementById('firebase-modal').classList.remove('active');
      });

      document.getElementById('firebase-save-btn').addEventListener('click', () => {
        const val = document.getElementById('firebase-config-input').value.trim();
        try {
          const parsed = JSON.parse(val);
          if (!parsed.apiKey || !parsed.projectId) {
            throw new Error('Config missing apiKey or projectId.');
          }
          localStorage.setItem(STORAGE_KEYS.FIREBASE_CONFIG, JSON.stringify(parsed));
          this.closeModals();
          this.showToast('Firebase configuration saved! Reloading...', 'success');
          setTimeout(() => window.location.reload(), 800);
        } catch (e) {
          alert('Invalid JSON config. Please paste the exact object from Firebase Console.');
        }
      });

      document.getElementById('firebase-reset-demo-btn').addEventListener('click', () => {
        localStorage.removeItem(STORAGE_KEYS.FIREBASE_CONFIG);
        this.closeModals();
        this.showToast('Reset to local offline storage mode.', 'volt');
        setTimeout(() => window.location.reload(), 500);
      });

      this.initWizard();
    }
  };

  /* Initialize app when DOM is ready */
  document.addEventListener('DOMContentLoaded', () => {
    AppUI.init();
  });

})();
