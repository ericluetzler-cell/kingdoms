# Konten, Freunde und Battle Pass einschalten (Firebase)

Kingdoms speichert Konten, Freundeslisten, Chats und den Battle-Pass-Fortschritt in **Firebase** (Google).
Für eine Freundesgruppe reicht der kostenlose Tarif („Spark“), eine Kreditkarte braucht es nicht.
Solange nichts eingetragen ist, läuft das Spiel wie bisher. Der Battle Pass zählt dann nur auf dem jeweiligen Gerät.

## Einmalig einrichten

1. Öffne <https://console.firebase.google.com>, klicke auf **Projekt erstellen** und gib z. B. „kingdoms“ ein. Google Analytics kannst du ausschalten.
2. Klicke in der Projektübersicht auf **</>** (Web-App hinzufügen), gib einen Namen ein und klicke auf **Registrieren**.
   Kopiere den angezeigten Block `const firebaseConfig = { … }`.
3. Gehe zu **Build → Authentication → Los geht's → Anmeldemethode** und schalte ein:
   - **E-Mail/Passwort**
   - **Google** (dabei eine Support-E-Mail wählen)
4. Füge unter **Authentication → Einstellungen → Autorisierte Domains** `ericluetzler-cell.github.io` hinzu. `localhost` steht dort schon.
5. Gehe zu **Build → Firestore Database → Datenbank erstellen**:
   - Edition **Standard**
   - Standort **europe-west3 (Frankfurt)**
   - **Produktionsmodus**
6. Lösche im Firestore-Reiter **Regeln** alles, füge den Inhalt von [`firestore.rules`](firestore.rules) ein und klicke auf **Veröffentlichen**.
7. Trage in [`firebase-config.js`](firebase-config.js) den Block aus Schritt 2 ein:

   ```js
   window.KINGDOMS_FIREBASE = {
     apiKey: '…',
     authDomain: '….firebaseapp.com',
     projectId: '…',
     storageBucket: '…',
     messagingSenderId: '…',
     appId: '…',
   };
   ```

   Diese Werte sind **nicht geheim**: Sie stehen in jeder Firebase-Web-App öffentlich im Code. Geschützt sind die Daten durch die Regeln aus Schritt 6.

## Testen ohne Firebase

Hänge `?mockcloud=a` an die Adresse, in einem zweiten Tab `?mockcloud=b`. Ein nachgebauter Server im Browser spielt dann zwei Konten durch: Anmelden, Freunde, Chat, Einladungen und Battle Pass. Nichts davon verlässt den Browser.
