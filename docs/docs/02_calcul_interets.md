# 2. Calcul des intérêts (méthode exacte)

## 2.1 Données de base d’un contrat

- Capital financé initial (S0)
- Taux annuel nominal (ex : 18,99 %)
- Dates de prélèvement
- Date d’origine du contrat

Le calcul se fait AU JOUR PRÈS.

---

## 2.2 Nombre de jours

Pour chaque paiement :

- Paiement 1 :
  J1 = Date paiement 1 − Date d’origine

- Paiement n :
  Jn = Date paiement n − Date paiement n-1

Les jours réels sont utilisés (365).

---

## 2.3 Formule d’intérêt

Pour chaque ligne :

Intérêt = Solde début × Taux annuel × (Nombre de jours / 365)

Exemple :
Solde début = 2 250,00  
Taux = 18,99 %  
Jours = 14  

Intérêt = 2 250 × 0,1899 × (14 / 365)

Le résultat est arrondi à 0,01 $.

---

## 2.4 Décomposition d’un paiement

Chaque prélèvement est composé de :

- Intérêts
- Capital
- Frais d’adhésion (séparé du capital)

Capital remboursé = Paiement prêt − Intérêts

---

## 2.5 Mise à jour du solde

Solde fin = Solde début − Capital remboursé

Ce solde sert de base au calcul suivant.

---

## 2.6 Point clé (source de confusion)

Le montant TOTAL prélevé
≠
Le montant qui réduit le solde

Les frais d’adhésion et pénalités
ne réduisent JAMAIS le capital.
