# Déploiement ALTITUDE OS — de zéro à l'URL publique

Ce guide suppose un Mac et un compte GitHub.

## 1. Tester le site dans le Terminal

Ouvre Terminal puis va dans le dossier du projet :

```bash
cd ~/Downloads/altitude-os-production
```

Lance le serveur local :

```bash
python3 -m http.server 8080
```

Ouvre ensuite :

```text
http://localhost:8080
```

Ne double-clique pas simplement sur `index.html` pour tester l'auth cloud : un serveur HTTP local est plus fiable.

---

## 2. Créer le backend Supabase

1. Va sur Supabase et crée un nouveau projet.
2. Dans le projet, ouvre **SQL Editor**.
3. Ouvre le fichier `supabase/schema.sql` de ce repo.
4. Copie tout son contenu dans SQL Editor et exécute-le.
5. Vérifie que les tables `profiles`, `user_states` et `subscriptions` existent.
6. Vérifie dans Storage que le bucket privé `trade-media` existe.

### Récupérer les clés frontend

Dans les paramètres du projet Supabase, récupère :

- Project URL
- publishable key ou anon key

Pour un test local, ouvre `config.js` et renseigne :

```js
window.ALTITUDE_CONFIG = {
  SUPABASE_URL: 'https://xxxx.supabase.co',
  SUPABASE_ANON_KEY: 'ta-cle-publique',
  APP_URL: 'http://localhost:8080/'
};
```

**Ne mets jamais `service_role` ici.**

### Configurer l'authentification

Dans Supabase Auth, ajoute les URLs autorisées :

```text
http://localhost:8080/
```

Plus tard, ajoute aussi l'URL GitHub Pages et ton domaine personnalisé.

Garde la confirmation email activée pour la production.

---

## 3. Déployer la fonction de suppression de compte

Le code est fourni dans :

```text
supabase/functions/delete-account/index.ts
```

La méthode la plus propre utilise la CLI Supabase.

Installe la CLI si nécessaire, connecte-toi, lie ton projet, puis :

```bash
supabase functions deploy delete-account
```

La fonction utilise les secrets système Supabase côté serveur. La clé `service_role` ne doit jamais atteindre GitHub Pages.

---

## 4. Créer le dépôt GitHub depuis le Terminal

Dans le dossier du projet :

```bash
git init
git add .
git commit -m "Initial ALTITUDE OS production"
git branch -M main
```

Ensuite, sur github.com :

1. clique sur **New repository** ;
2. nom proposé : `altitude-os` ;
3. ne coche pas l'ajout automatique d'un README, car il existe déjà ;
4. crée le dépôt.

GitHub t'affichera une URL ressemblant à :

```text
https://github.com/TON-UTILISATEUR/altitude-os.git
```

Dans Terminal :

```bash
git remote add origin https://github.com/TON-UTILISATEUR/altitude-os.git
git push -u origin main
```

Si GitHub demande une authentification, utilise la méthode proposée par GitHub : navigateur, credential manager ou token personnel.

---

## 5. Ajouter les paramètres Supabase à GitHub

Dans ton repo GitHub :

**Settings → Secrets and variables → Actions**

### Variable repository

Ajoute :

```text
SUPABASE_URL
```

avec la Project URL Supabase.

Ajoute aussi :

```text
APP_URL
```

Et, uniquement lorsque Stripe sera configuré :

```text
BILLING_ENABLED
```

avec la valeur `true`.

Au premier déploiement, elle peut être :

```text
https://TON-UTILISATEUR.github.io/altitude-os/
```

### Secret repository

Ajoute :

```text
SUPABASE_ANON_KEY
```

avec la clé publishable/anon Supabase.

Cette clé est techniquement destinée au navigateur, mais la conserver dans GitHub Actions évite de la laisser dans le code source brut.

---

## 6. Activer GitHub Pages

Dans le repo :

**Settings → Pages → Build and deployment → Source → GitHub Actions**

Le fichier :

```text
.github/workflows/deploy-pages.yml
```

est déjà fourni.

Ensuite fais un nouveau push ou lance manuellement le workflow dans l'onglet **Actions**.

Après réussite, GitHub te donnera une URL du type :

```text
https://TON-UTILISATEUR.github.io/altitude-os/
```

Ajoute cette URL dans les Redirect URLs de Supabase Auth.

---

## 7. Mettre à jour le projet après une modification

À chaque fois :

```bash
git status
git add .
git commit -m "Description de la modification"
git push
```

GitHub Actions redéploiera automatiquement le site.

---

## 8. Ajouter un nom de domaine plus tard

Exemple :

```text
altitudeos.com
```

Dans GitHub :

**Settings → Pages → Custom domain**

Ajoute ton domaine, puis configure les DNS chez ton registrar selon les valeurs fournies par GitHub.

Ensuite :

1. remplace `APP_URL` dans GitHub par ton domaine ;
2. ajoute le domaine dans Supabase Auth Redirect URLs ;
3. active HTTPS dans GitHub Pages.

---

## 9. Dépôt public ou privé ?

Pour tester gratuitement avec GitHub Pages, un repo public est le chemin le plus simple.

Si tu veux commercialiser ALTITUDE OS et ne pas exposer le code source, évite de rester sur un repo public. Deux options :

- repo privé + un plan GitHub permettant GitHub Pages privé ;
- repo privé + déploiement sur Vercel, Netlify ou Cloudflare Pages.

Le backend Supabase reste identique dans tous les cas.
