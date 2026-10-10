import {createElectronRepositories} from '../persistence/electron/createElectronRepositories';
import {requestReauthentication} from './reauthentication';
import { createContext, useContext } from 'react';
import { createWebRepositories } from '../persistence';
import { createPdvApplication } from './createPdvApplication';
export const webApplication = createPdvApplication(typeof window!=='undefined'&&window.raizDesktop?createElectronRepositories(window.raizDesktop.pdv,{reauthenticate:requestReauthentication}):createWebRepositories());
export const ApplicationContext = createContext(webApplication);
export const usePdvApplication = () => useContext(ApplicationContext);
