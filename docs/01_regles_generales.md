# 1. Règles générales de calcul des prêts

## 1.1 Deux notions différentes (fondamental)

Il existe TOUJOURS deux soldes distincts :

1) Le solde du CONTRAT
2) Le solde de SOUFFRANCE

Ils ne doivent JAMAIS être mélangés.

---

## 1.2 Le contrat (stable)

Le contrat est défini à l’origine et ne change pas :

- Montant financé
- Taux d’intérêt
- Dates de paiement
- Méthode de calcul

Même en cas de NSF ou de report, le contrat continue
son calcul normal.

---

## 1.3 La souffrance (événementielle)

La souffrance provient de :
- Paiement non passé (NSF)
- Frais NSF
- Frais de report
- Ajustements manuels

La souffrance est une dette temporaire,
séparée du contrat.

---

## 1.4 Erreur fréquente (ce que fait Margill)

Margill mélange :
- le solde du contrat
- les montants en souffrance

Ce mélange donne l’impression que le client
doit PLUS que le paiement manqué,
même sans nouveau frais.

---

## 1.5 Principe clé pour le futur dashboard

Le client doit toujours voir :
- Ce qu’il devait selon le contrat
- Ce qu’il doit EN PLUS à cause d’un événement
