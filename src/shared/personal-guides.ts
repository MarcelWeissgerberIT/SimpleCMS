/** Recipient-only preparation, served outside the collaborative workspace documents. */
export interface PersonalGuide { id: string; title: string; sections: Array<{title:string;body:string;prompt?:string}> }
