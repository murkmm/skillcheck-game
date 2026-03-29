import { getPermalink } from './utils/permalinks';

export const headerData = {
  links: [
    {
      text: 'Play Daily',
      href: getPermalink('/'),
    },
    {
      text: 'Leaderboard',
      href: getPermalink('/leaderboard'), // Adjust this if your URL is different
    },
    {
      text: 'How to Play',
      href: getPermalink('/#how-to-play'), // Great to link to an anchor on your homepage
    },
    {
      text: 'Support the Dev',
      href: getPermalink('/premium'), // Or link directly to your Ko-fi/payment page
    },
  ],
  actions: [
    { text: 'Play Now', href: getPermalink('/') }
  ],
};

export const footerData = {
  links: [
    {
      title: 'Skillcheck',
      links: [
        { text: 'Play Today', href: getPermalink('/') },
        { text: 'Global Leaderboard', href: getPermalink('/leaderboard') },
        { text: 'How to Play', href: getPermalink('/#how-to-play') },
      ],
    },
    {
      title: 'Community',
      links: [
        { text: 'Support the Dev', href: getPermalink('/premium') },
        { text: 'Twitter / X', href: '#' }, // Replace # with your actual link when ready
        { text: 'Discord Server', href: '#' }, // Replace # with your actual link when ready
      ],
    },
    {
      title: 'Legal',
      links: [
        { text: 'Terms of Service', href: getPermalink('/terms') },
        { text: 'Privacy Policy', href: getPermalink('/privacy') },
        { text: 'Contact Us', href: getPermalink('/contact') },
      ],
    },
  ],
  secondaryLinks: [
    { text: 'Terms', href: getPermalink('/terms') },
    { text: 'Privacy Policy', href: getPermalink('/privacy') },
  ],
  socialLinks: [
    { ariaLabel: 'X', icon: 'tabler:brand-x', href: '#' }, // Add your Twitter link here
    { ariaLabel: 'Discord', icon: 'tabler:brand-discord', href: '#' }, // Swapped Github for Discord
  ],
  footNote: `
    © ${new Date().getFullYear()} Skillcheckgame.com · All rights reserved.
  `,
};