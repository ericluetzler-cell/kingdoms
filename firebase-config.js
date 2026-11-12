/* Kingdoms – Zugang zum Online-Speicher (Firebase) für Konten, Freunde, Chat und Battle Pass.
   Hier den Block „firebaseConfig“ aus der Firebase-Konsole eintragen (Projekteinstellungen → Meine Apps → Web-App).
   Diese Werte sind nicht geheim – geschützt werden die Daten durch die Regeln in firestore.rules.
   Solange hier null steht, gibt es keine Konten; der Battle Pass zählt dann nur auf diesem Gerät. */
window.KINGDOMS_FIREBASE = {
  apiKey: 'AIzaSyBJJKd4fhqM-6BhQ5w7PcWhnjgA1CiLT1Q',
  authDomain: 'kingdoms-fe3f0.firebaseapp.com',
  projectId: 'kingdoms-fe3f0',
  storageBucket: 'kingdoms-fe3f0.firebasestorage.app',
  messagingSenderId: '112041999036',
  appId: '1:112041999036:web:9dfff974fce749a28d2eb9',
};
